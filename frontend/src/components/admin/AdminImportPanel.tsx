"use client";

// Admin bulk listing import (docs/API_CONTRACTS.md "Admin bulk listing
// import"): download the template, pick a CSV, get a per-row dry-run report,
// confirm, and watch the import run in small sequential batches.
//
// Flow: file -> parse in the browser (lib/adminImportCsv) -> validateImportAction
// (writes nothing) -> admin reviews -> importChunkAction per chunk of 20 rows
// (geocodes, then writes) -> final per-row report, downloadable as CSV.
// Chunks run strictly one at a time; a failed chunk stops the run and can be
// resumed (the API is idempotent, so a re-sent chunk never duplicates).
// Pure logic lives in lib/adminImport{Csv,Report,Run}.ts. Mobile-first: 44px
// targets, tables scroll inside their own container.
import Link from "next/link";
import { useRef, useState } from "react";
import { importChunkAction, validateImportAction } from "@/app/admin/import/actions";
import {
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  REQUIRED_COLUMNS,
  TEMPLATE_CSV,
  checkFileSize,
  decodeUtf8,
  parseImportCsv,
} from "@/lib/adminImportCsv";
import {
  RESULT_LABEL,
  STATUS_LABEL,
  chunk,
  filterByStatus,
  finalReport,
  importableRows,
  issueSummary,
  missingText,
  progressPercent,
  resultCsv,
  summarizeResults,
  summarizeValidation,
  validationCsv,
} from "@/lib/adminImportReport";
import { runChunks } from "@/lib/adminImportRun";
import type {
  CommittedRow,
  ImportRowInput,
  ImportRowStatus,
  ValidatedRow,
} from "@/types/adminImport";

const BTN_PRIMARY =
  "flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const BTN_SECONDARY =
  "flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";
const CARD = "rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5";

type Stage = "idle" | "checking" | "checked" | "importing" | "paused" | "done";

const STATUS_STYLE: Record<ImportRowStatus, string> = {
  valid: "bg-green-100 text-green-900",
  warning: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-900",
  duplicate: "bg-slate-200 text-slate-900",
};

const RESULT_STYLE: Record<CommittedRow["result"], string> = {
  created: "bg-green-100 text-green-900",
  skipped_duplicate: "bg-slate-200 text-slate-900",
  skipped_warning: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-900",
};

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function AdminImportPanel() {
  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ImportRowInput[]>([]);
  const [validated, setValidated] = useState<ValidatedRow[]>([]);
  const [filter, setFilter] = useState<ImportRowStatus | "all">("all");
  const [includeWarnings, setIncludeWarnings] = useState(false);
  const [results, setResults] = useState<CommittedRow[]>([]);
  const [doneRows, setDoneRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [geocodedCount, setGeocodedCount] = useState(0);
  const stopRef = useRef(false);
  const remainingRef = useRef<ImportRowInput[][]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summary = summarizeValidation(validated);
  const toImport = importableRows(parsed, validated, includeWarnings);
  const busy = stage === "checking" || stage === "importing";

  function reset() {
    setStage("idle");
    setFileName(null);
    setFileError(null);
    setNotices([]);
    setParsed([]);
    setValidated([]);
    setResults([]);
    setFilter("all");
    setIncludeWarnings(false);
    setRunError(null);
    setDoneRows(0);
    setGeocodedCount(0);
    remainingRef.current = [];
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);

    const sizeProblem = checkFileSize(file.size);
    if (sizeProblem) return setFileError(sizeProblem);
    let text: string | null;
    try {
      text = decodeUtf8(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return setFileError("The file could not be read. Please try again.");
    }
    if (text === null) {
      return setFileError(
        "The file is not UTF-8 text. In Excel use Save As > CSV UTF-8, or export CSV from Google Sheets."
      );
    }
    const result = parseImportCsv(text);
    if (!result.ok) return setFileError(result.error);

    setParsed(result.rows);
    setNotices(result.notices);
    setStage("checking");
    try {
      const check = await validateImportAction(result.rows);
      if (!check.ok) {
        setFileError(check.error);
        setStage("idle");
        return;
      }
      setValidated(check.rows);
      setStage("checked");
    } catch {
      setFileError("Something went wrong while checking the file. Please try again.");
      setStage("idle");
    }
  }

  async function startImport(chunks: ImportRowInput[][], previous: CommittedRow[]) {
    stopRef.current = false;
    setRunError(null);
    setStage("importing");
    const state = await runChunks(
      chunks,
      async (rows) => {
        const res = await importChunkAction(rows, includeWarnings);
        if (!res.ok) return { ok: false, error: res.error };
        setGeocodedCount((n) => n + res.geocoded);
        return { ok: true, rows: res.rows };
      },
      {
        onProgress: (_done, _total, soFar) => {
          setResults(soFar);
          setDoneRows(soFar.length);
        },
        shouldStop: () => stopRef.current,
      },
      previous
    );
    setResults(state.results);
    setDoneRows(state.results.length);
    remainingRef.current = state.remaining;
    if (state.stopped === "done") {
      setStage("done");
    } else {
      setRunError(
        state.stopped === "error"
          ? `${state.error ?? "A batch failed."} Rows already imported are kept. Resume to continue; nothing will be duplicated.`
          : "Import paused. Rows already imported are kept."
      );
      setStage("paused");
    }
  }

  function onImport() {
    const chunks = chunk(toImport, IMPORT_LIMITS.chunkSize);
    setTotalRows(toImport.length);
    setResults([]);
    setDoneRows(0);
    setGeocodedCount(0);
    void startImport(chunks, []);
  }

  function onResume() {
    void startImport(remainingRef.current, results);
  }

  const report = finalReport(validated, results);
  const resultSummary = summarizeResults(report);
  const shownRows = filterByStatus(validated, filter);
  const percent = progressPercent(doneRows, totalRows);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="import-how" className={CARD}>
        <h2 id="import-how" className="font-display text-lg font-bold text-brand-ink">
          1. Get the template and choose your file
        </h2>
        <p className="mt-2 text-sm text-brand-ink-muted">
          One restaurant per row. Imported listings are <strong>unclaimed</strong> and verified.{" "}
          <strong>
            They are created hidden (coming soon). Open each one, complete what&apos;s missing and activate
            it.
          </strong>{" "}
          Up to {IMPORT_LIMITS.maxRows} rows and 1 MB, saved as CSV (UTF-8). Nothing is saved until you
          confirm in step 2.
        </p>
        <details className="mt-3 text-sm text-brand-ink-muted">
          <summary className="min-h-[44px] cursor-pointer py-3 font-semibold text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
            Column guide
          </summary>
          <p className="mt-1">
            Required: {REQUIRED_COLUMNS.join(", ")}. Optional: {IMPORT_COLUMNS.filter(
              (c) => !(REQUIRED_COLUMNS as readonly string[]).includes(c)
            ).join(", ")}.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>state is two letters; postal_code is a 5-digit ZIP.</li>
            <li>phone is a 10-digit US number, for example (214) 555-0142.</li>
            <li>type is one cuisine or restaurant-type tag, for example South Indian.</li>
            <li>
              hours (last column, optional) looks like{" "}
              <code>Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed</code> or{" "}
              <code>daily 11:00-22:00</code>: days Mon to Sun, 24-hour times, one window per day. If it
              cannot be read the row still imports, without hours.
            </li>
            <li>
              Every imported listing needs a name, full address, valid US phone and opening hours for all 7
              days before it can be activated. The check below shows what each row still needs.
            </li>
            <li>
              Leave latitude and longitude blank to have them looked up when you import. Rows that
              cannot be placed are listed so you can fix them later.
            </li>
          </ul>
        </details>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => download("swarasa-import-template.csv", TEMPLATE_CSV)}
          >
            Download CSV template
          </button>
          <div>
            <label
              htmlFor="import-file"
              className={`${BTN_PRIMARY} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              Choose CSV file
            </label>
            <input
              ref={fileInputRef}
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              disabled={busy}
              className="sr-only"
            />
          </div>
        </div>
        {fileName && !fileError && (
          <p className="mt-3 break-all text-sm text-brand-ink-muted">File: {fileName}</p>
        )}
        {fileError && (
          <p role="alert" className="mt-3 rounded-brand-control bg-red-50 px-3 py-2 text-sm text-red-900">
            {fileError}
          </p>
        )}
        {notices.map((n) => (
          <p key={n} className="mt-2 text-sm text-brand-ink-muted">
            {n}
          </p>
        ))}
      </section>

      {stage === "checking" && (
        <p role="status" aria-busy="true" className={`${CARD} text-sm text-brand-ink-muted`}>
          Checking {parsed.length} rows against the taxonomy and existing listings…
        </p>
      )}

      {validated.length > 0 && (
        <section aria-labelledby="import-report" className={CARD}>
          <h2 id="import-report" className="font-display text-lg font-bold text-brand-ink">
            2. Review the check
          </h2>
          <p role="status" className="mt-2 text-sm text-brand-ink-muted">
            Row numbers match your spreadsheet (the header is row 1).
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                ["valid", summary.valid],
                ["warning", summary.warning],
                ["error", summary.error],
                ["duplicate", summary.duplicate],
              ] as const
            ).map(([status, n]) => (
              <li key={status} className="rounded-brand-control border border-brand-border px-3 py-2 text-sm">
                <span className={`mr-2 inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
                  {STATUS_LABEL[status]}
                </span>
                <span className="font-semibold text-brand-ink">{n}</span>
              </li>
            ))}
            <li className="rounded-brand-control border border-brand-border px-3 py-2 text-sm">
              <span className="mr-2 text-xs font-semibold text-brand-ink-muted">No coordinates</span>
              <span className="font-semibold text-brand-ink">{summary.needs_geocoding}</span>
            </li>
          </ul>
          <p className="mt-3 text-sm text-brand-ink-muted">
            Every row that can be imported is created <strong>hidden</strong>.{" "}
            <strong>{summary.ready_to_activate}</strong> will have nothing missing (review and activate
            them); <strong>{summary.incomplete}</strong> still need something filled in (see &quot;Still
            needed&quot;).
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-56">
              <label htmlFor="import-filter" className="text-sm font-semibold text-brand-ink">
                Show rows
              </label>
              <select
                id="import-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value as ImportRowStatus | "all")}
                className={`mt-1 ${INPUT}`}
              >
                <option value="all">All ({summary.total})</option>
                <option value="error">Errors ({summary.error})</option>
                <option value="warning">Warnings ({summary.warning})</option>
                <option value="duplicate">Duplicates ({summary.duplicate})</option>
                <option value="valid">Ready ({summary.valid})</option>
              </select>
            </div>
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => download("swarasa-import-check.csv", validationCsv(validated))}
            >
              Download check as CSV
            </button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-brand-control border border-brand-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Per-row check results</caption>
              <thead className="bg-brand-chip text-brand-ink">
                <tr>
                  <th scope="col" className="px-3 py-2">Row</th>
                  <th scope="col" className="px-3 py-2">Name</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Problems</th>
                  <th scope="col" className="px-3 py-2">Still needed before activation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {shownRows.map((r) => (
                  <tr key={r.row_number} className="align-top">
                    <td className="px-3 py-2 tabular-nums">{r.row_number}</td>
                    <td className="px-3 py-2 break-words">{r.name}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 break-words text-brand-ink-muted">
                      {issueSummary(r) || (r.needs_geocoding ? "No coordinates: will be looked up on import." : "")}
                    </td>
                    <td className="px-3 py-2 break-words text-brand-ink-muted">
                      {r.status === "valid" || r.status === "warning"
                        ? r.missing.length > 0
                          ? missingText(r.missing)
                          : "Nothing: ready to activate"
                        : ""}
                    </td>
                  </tr>
                ))}
                {shownRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-brand-ink-muted">
                      No rows in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stage === "checked" && (
        <section aria-labelledby="import-confirm" className={CARD}>
          <h2 id="import-confirm" className="font-display text-lg font-bold text-brand-ink">
            3. Import
          </h2>
          {summary.warning > 0 && (
            <label className="mt-3 flex min-h-[44px] items-center gap-3 text-sm text-brand-ink">
              <input
                type="checkbox"
                checked={includeWarnings}
                onChange={(e) => setIncludeWarnings(e.target.checked)}
                className="h-5 w-5"
              />
              Also import the {summary.warning} row(s) with warnings (possible duplicates, unknown type)
            </label>
          )}
          <p className="mt-2 text-sm text-brand-ink-muted">
            {toImport.length} listing(s) will be created <strong>hidden (coming soon)</strong>, not public
            anywhere until you open each one, complete what&apos;s missing and activate it. Errors and
            duplicates are skipped. Running this again with the same file creates nothing new.
          </p>
          <button
            type="button"
            className={`${BTN_PRIMARY} mt-4 w-full sm:w-auto`}
            disabled={toImport.length === 0}
            onClick={onImport}
          >
            Import {toImport.length} listing{toImport.length === 1 ? "" : "s"}
          </button>
        </section>
      )}

      {(stage === "importing" || stage === "paused" || stage === "done") && (
        <section aria-labelledby="import-progress" className={CARD}>
          <h2 id="import-progress" className="font-display text-lg font-bold text-brand-ink">
            {stage === "done" ? "Import finished" : "Importing"}
          </h2>
          <div
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={stage === "done" ? 100 : percent}
            className="mt-3 h-3 w-full overflow-hidden rounded-full bg-brand-chip"
          >
            <div
              className="h-full bg-brand-accent transition-all"
              style={{ width: `${stage === "done" ? 100 : percent}%` }}
            />
          </div>
          <p role="status" className="mt-2 text-sm text-brand-ink-muted">
            {stage === "done"
              ? `Done: ${resultSummary.created} created hidden (${resultSummary.created_ready_to_activate} with nothing missing, ${resultSummary.created_incomplete} still needing info), ${resultSummary.skipped_duplicate} skipped as duplicates, ${resultSummary.skipped_warning} skipped (warnings), ${resultSummary.failed} not imported.`
              : `${doneRows} of ${totalRows} rows processed…`}
          </p>
          {runError && (
            <p role="alert" className="mt-3 rounded-brand-control bg-red-50 px-3 py-2 text-sm text-red-900">
              {runError}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            {stage === "importing" && (
              <button type="button" className={BTN_SECONDARY} onClick={() => (stopRef.current = true)}>
                Stop after this batch
              </button>
            )}
            {stage === "paused" && (
              <button type="button" className={BTN_PRIMARY} onClick={onResume}>
                Resume import
              </button>
            )}
            {(stage === "done" || stage === "paused") && (
              <button
                type="button"
                className={BTN_SECONDARY}
                onClick={() => download("swarasa-import-results.csv", resultCsv(report))}
              >
                Download results as CSV
              </button>
            )}
            {stage === "done" && (
              <button type="button" className={BTN_SECONDARY} onClick={reset}>
                Import another file
              </button>
            )}
          </div>
          {(stage === "done" || stage === "paused") && resultSummary.created > 0 && (
            <p className="mt-3 text-sm text-brand-ink-muted">
              None of the {resultSummary.created} created listing(s) are public yet. Open each one, complete
              what is missing and activate it.{" "}
              <Link
                href="/admin/listings?status=coming_soon"
                className="inline-flex min-h-[44px] items-center font-semibold text-brand-accent underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                Find them in Admin &gt; Listings (Coming soon)
              </Link>
            </p>
          )}
          {stage === "done" && resultSummary.needs_geocoding > 0 && (
            <p className="mt-3 text-sm text-brand-ink-muted">
              {resultSummary.needs_geocoding} listing(s) were created without a map point (the address could
              not be placed) and will not appear in distance search. Download the results CSV and fix them in
              Admin &gt; Listings, or run <code>scripts/geocode_missing_locations.py</code>.
              {geocodedCount > 0 ? ` ${geocodedCount} other listing(s) were placed automatically.` : ""}
            </p>
          )}

          {(stage === "done" || stage === "paused") && report.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-brand-control border border-brand-border">
              <table className="w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">Per-row import results</caption>
                <thead className="bg-brand-chip text-brand-ink">
                  <tr>
                    <th scope="col" className="px-3 py-2">Row</th>
                    <th scope="col" className="px-3 py-2">Name</th>
                    <th scope="col" className="px-3 py-2">Result</th>
                    <th scope="col" className="px-3 py-2">Still needed before activation</th>
                    <th scope="col" className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {report.map((r) => (
                    <tr key={r.row_number} className="align-top">
                      <td className="px-3 py-2 tabular-nums">{r.row_number}</td>
                      <td className="px-3 py-2 break-words">{r.name}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${RESULT_STYLE[r.result]}`}>
                          {RESULT_LABEL[r.result]}
                        </span>
                      </td>
                      <td className="px-3 py-2 break-words text-brand-ink-muted">
                        {r.result === "created"
                          ? r.missing.length > 0
                            ? missingText(r.missing)
                            : "Nothing: ready to activate"
                          : ""}
                      </td>
                      <td className="px-3 py-2 break-words text-brand-ink-muted">
                        {r.reason ?? (r.needs_geocoding ? "Created without coordinates." : "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
