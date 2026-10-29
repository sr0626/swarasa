// Report helpers for the admin bulk import page: spreadsheet-formula
// neutralising, CSV download builders, validation/result summaries and which
// rows may be imported. Pure (adminImportReport.test.ts).
import type {
  CommittedRow,
  CommitSummary,
  ImportRowInput,
  ImportRowStatus,
  ValidatedRow,
  ValidateSummary,
} from "../types/adminImport";

/**
 * Spreadsheet formula injection guard. A cell that starts with = + - @ (or a
 * tab / carriage return, which Excel also treats as a formula lead-in) is
 * prefixed with an apostrophe so Excel/Sheets show it as text. Applied to
 * EVERY string cell of every downloaded report, whatever its origin.
 */
export function neutralizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export type CsvCell = string | number | boolean | null | undefined;

function csvEscape(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  const text = typeof cell === "string" ? neutralizeCell(cell) : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text (CRLF, UTF-8 BOM so Excel reads accents) with every cell neutralised and escaped. */
export function toCsvText(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function issueSummary(row: ValidatedRow): string {
  return row.issues
    .filter((i) => i.severity !== "info")
    .map((i) => i.message)
    .join(" ");
}

/** Short wording per `listing_readiness` key, for the "what's missing" column. */
export const MISSING_LABEL: Record<string, string> = {
  name: "restaurant name",
  address: "full street address",
  phone: "valid US phone number",
  hours: "opening hours for all 7 days",
};

/** Human labels for the missing keys, in the order given (unknown keys are shown as-is). */
export function missingLabels(keys: readonly string[]): string[] {
  return keys.map((key) => MISSING_LABEL[key] ?? key);
}

/** "opening hours for all 7 days; valid US phone number" — empty string when nothing is missing. */
export function missingText(keys: readonly string[]): string {
  return missingLabels(keys).join("; ");
}

export function validationCsv(rows: ValidatedRow[]): string {
  return toCsvText(
    ["row", "name", "status", "problems", "needs_geocoding", "will_be", "missing"],
    rows.map((r) => {
      const importable = r.status === "valid" || r.status === "warning";
      return [
        r.row_number,
        r.name,
        r.status,
        issueSummary(r),
        r.needs_geocoding ? "yes" : "no",
        importable ? "hidden" : "",
        importable ? missingText(r.missing) : "",
      ];
    })
  );
}

/**
 * `status` = what the listing is now ("hidden" for every created row, empty
 * for rows that were not created); `missing` = everything still needed before
 * it can be activated (empty on a created row = ready to activate).
 */
export function resultCsv(rows: CommittedRow[]): string {
  return toCsvText(
    ["row", "name", "result", "status", "missing", "reason", "listing_id", "needs_geocoding"],
    rows.map((r) => [
      r.row_number,
      r.name,
      r.result,
      r.result === "created" ? "hidden" : "",
      r.result === "created" ? missingText(r.missing) : "",
      r.reason,
      r.location_id,
      r.needs_geocoding ? "yes" : "no",
    ])
  );
}

export const STATUS_LABEL: Record<ImportRowStatus, string> = {
  valid: "Ready",
  warning: "Warning",
  error: "Error",
  duplicate: "Duplicate",
};

export const RESULT_LABEL: Record<CommittedRow["result"], string> = {
  created: "Created hidden",
  skipped_duplicate: "Skipped (duplicate)",
  skipped_warning: "Skipped (warning)",
  failed: "Failed",
};

/** Rows the admin may import: ready rows, plus warning rows only on opt-in. Never errors or duplicates. */
export function importableRows(
  parsed: ImportRowInput[],
  validated: ValidatedRow[],
  includeWarnings: boolean
): ImportRowInput[] {
  const ok = new Set<number>();
  for (const v of validated) {
    if (v.status === "valid" || (includeWarnings && v.status === "warning")) ok.add(v.row_number);
  }
  return parsed.filter((r) => ok.has(r.row_number));
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function filterByStatus(rows: ValidatedRow[], status: ImportRowStatus | "all"): ValidatedRow[] {
  return status === "all" ? rows : rows.filter((r) => r.status === status);
}

export function summarizeValidation(rows: ValidatedRow[]): ValidateSummary {
  const count = (s: ImportRowStatus) => rows.filter((r) => r.status === s).length;
  const importable = rows.filter((r) => r.status === "valid" || r.status === "warning");
  return {
    total: rows.length,
    valid: count("valid"),
    warning: count("warning"),
    error: count("error"),
    duplicate: count("duplicate"),
    needs_geocoding: rows.filter((r) => r.needs_geocoding && r.status !== "error").length,
    ready_to_activate: importable.filter((r) => r.missing.length === 0).length,
    incomplete: importable.filter((r) => r.missing.length > 0).length,
  };
}

export function summarizeResults(rows: CommittedRow[]): CommitSummary {
  const count = (s: CommittedRow["result"]) => rows.filter((r) => r.result === s).length;
  return {
    created: count("created"),
    skipped_duplicate: count("skipped_duplicate"),
    skipped_warning: count("skipped_warning"),
    failed: count("failed"),
    needs_geocoding: rows.filter((r) => r.needs_geocoding).length,
    created_ready_to_activate: rows.filter((r) => r.result === "created" && r.missing.length === 0).length,
    created_incomplete: rows.filter((r) => r.result === "created" && r.missing.length > 0).length,
  };
}

/**
 * Final per-row report for the whole file: one line per file row, in file
 * order. Rows that were never sent (validation error / duplicate / warning not
 * included) are reported with their validation outcome so the admin has one
 * complete account, including the earlier row a duplicate matched.
 */
export function finalReport(validated: ValidatedRow[], committed: CommittedRow[]): CommittedRow[] {
  const byRow = new Map(committed.map((c) => [c.row_number, c]));
  return validated.map((v) => {
    const c = byRow.get(v.row_number);
    if (c) return c;
    const reason = issueSummary(v);
    const result: CommittedRow["result"] =
      v.status === "duplicate" ? "skipped_duplicate" : v.status === "warning" ? "skipped_warning" : "failed";
    return {
      row_number: v.row_number,
      name: v.name,
      result,
      reason: v.status === "valid" ? "Not imported: the import was stopped before this row." : reason || null,
      brand_id: null,
      location_id: null,
      needs_geocoding: false,
      listing_status: null,
      missing: [],
    };
  });
}

export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}
