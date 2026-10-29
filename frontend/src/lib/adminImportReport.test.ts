// Unit tests for the admin import report helpers.  cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  chunk,
  finalReport,
  importableRows,
  missingLabels,
  missingText,
  neutralizeCell,
  progressPercent,
  resultCsv,
  summarizeResults,
  summarizeValidation,
  toCsvText,
  validationCsv,
} from "./adminImportReport.ts";
import type { CommittedRow, ImportRowInput, ValidatedRow } from "../types/adminImport.ts";

function v(row_number: number, status: ValidatedRow["status"], over: Partial<ValidatedRow> = {}): ValidatedRow {
  return {
    row_number,
    name: `R${row_number}`,
    status,
    issues: [],
    needs_geocoding: false,
    matched_tag: null,
    missing: [],
    duplicate_of_row: null,
    duplicate_of_listing_id: null,
    ...over,
  };
}

function created(row_number: number, over: Partial<CommittedRow> = {}): CommittedRow {
  return {
    row_number,
    name: `R${row_number}`,
    result: "created",
    reason: null,
    brand_id: 1,
    location_id: 1,
    needs_geocoding: false,
    listing_status: "coming_soon",
    missing: [],
    ...over,
  };
}

test("neutralizeCell prefixes formula lead-in characters only", () => {
  for (const bad of ["=1+1", "+1214", "-5", "@SUM(A1)", "\t=x", "\r=x"]) {
    assert.equal(neutralizeCell(bad), `'${bad}`);
  }
  for (const ok of ["Spice Hut", "1 Main St", "", "a=b", "x+y"]) {
    assert.equal(neutralizeCell(ok), ok);
  }
});

test("toCsvText neutralises every string cell, escapes, adds BOM and CRLF", () => {
  const text = toCsvText(["a", "b"], [["=cmd|' /C calc'!A0", 'say "hi", ok'], [3, null]]);
  assert.ok(text.startsWith("﻿a,b\r\n"));
  assert.ok(text.includes("'=cmd|' /C calc'!A0"));
  assert.ok(text.includes('"say ""hi"", ok"'));
  assert.ok(text.endsWith("3,\r\n"));
});

test("report CSVs neutralise hostile names and server reasons", () => {
  const rows: CommittedRow[] = [
    {
      row_number: 2,
      name: '=HYPERLINK("http://x")',
      result: "failed",
      reason: "+bad",
      brand_id: null,
      location_id: null,
      needs_geocoding: false,
      listing_status: null,
      missing: [],
    },
  ];
  const csv = resultCsv(rows);
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"http://x\"\")\""));
  assert.ok(csv.includes(",'+bad,"));
  const val = validationCsv([
    v(2, "error", { name: "@evil", issues: [{ field: null, severity: "error", code: "x", message: "-1 bad" }] }),
  ]);
  assert.ok(val.includes("'@evil") && val.includes("'-1 bad"));
});

test("importableRows: ready always, warnings only on opt-in, never errors or duplicates", () => {
  const parsed: ImportRowInput[] = [2, 3, 4, 5].map((n) => ({ row_number: n }));
  const validated = [v(2, "valid"), v(3, "warning"), v(4, "error"), v(5, "duplicate")];
  assert.deepEqual(
    importableRows(parsed, validated, false).map((r) => r.row_number),
    [2]
  );
  assert.deepEqual(
    importableRows(parsed, validated, true).map((r) => r.row_number),
    [2, 3]
  );
});

test("chunk splits evenly with a remainder and rejects a bad size", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.throws(() => chunk([1], 0));
});

test("summaries count each bucket", () => {
  const rows = [
    v(2, "valid", { needs_geocoding: true }),
    v(3, "warning", { missing: ["hours"] }),
    v(4, "error", { needs_geocoding: true }),
    v(5, "duplicate"),
  ];
  assert.deepEqual(summarizeValidation(rows), {
    total: 4,
    valid: 1,
    warning: 1,
    error: 1,
    duplicate: 1,
    needs_geocoding: 1,
    ready_to_activate: 1,
    incomplete: 1,
  });
  const committed: CommittedRow[] = [
    created(2, { missing: ["hours"], needs_geocoding: true }),
    {
      row_number: 3,
      name: "b",
      result: "skipped_duplicate",
      reason: "dup",
      brand_id: null,
      location_id: null,
      needs_geocoding: false,
      listing_status: null,
      missing: [],
    },
    created(4, { missing: [] }),
  ];
  assert.deepEqual(summarizeResults(committed), {
    created: 2,
    skipped_duplicate: 1,
    skipped_warning: 0,
    failed: 0,
    needs_geocoding: 1,
    created_ready_to_activate: 1,
    created_incomplete: 1,
  });
});

test("finalReport lists every file row in order, merging commit results with unsent rows", () => {
  const validated = [
    v(2, "valid"),
    v(3, "duplicate", {
      duplicate_of_row: 2,
      issues: [
        { field: null, severity: "error", code: "duplicate", message: "Duplicate of row 2 (same name and address). Skipped." },
      ],
    }),
    v(4, "error", { issues: [{ field: "phone", severity: "error", code: "bad_phone", message: "Invalid phone" }] }),
  ];
  const committed: CommittedRow[] = [
    created(2, { name: "R2", location_id: 9 }),
  ];
  const report = finalReport(validated, committed);
  assert.deepEqual(
    report.map((r) => [r.row_number, r.result]),
    [
      [2, "created"],
      [3, "skipped_duplicate"],
      [4, "failed"],
    ]
  );
  assert.match(report[1]?.reason ?? "", /row 2/);

  // A ready row that was never sent (import stopped) is not silently dropped.
  const stopped = finalReport([v(2, "valid")], []);
  assert.equal(stopped[0]?.result, "failed");
  assert.match(stopped[0]?.reason ?? "", /stopped/);
});

test("progressPercent is clamped", () => {
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(1, 4), 25);
  assert.equal(progressPercent(9, 4), 100);
});

test("missing keys map to plain words, unknown keys pass through", () => {
  assert.deepEqual(missingLabels(["hours", "phone"]), ["opening hours for all 7 days", "valid US phone number"]);
  assert.deepEqual(missingLabels(["future_thing"]), ["future_thing"]);
  assert.equal(missingText([]), "");
  assert.equal(missingText(["name", "address"]), "restaurant name; full street address");
});

test("results CSV has status (hidden) and missing columns; empty missing = ready", () => {
  const csv = resultCsv([
    created(2, { missing: ["hours", "phone"] }),
    created(3, { missing: [] }),
    { ...created(4), result: "skipped_duplicate", reason: "dup", location_id: null, listing_status: null },
  ]);
  const lines = csv.replace("\ufeff", "").trim().split("\r\n");
  assert.equal(lines[0], "row,name,result,status,missing,reason,listing_id,needs_geocoding");
  assert.equal(lines[1], "2,R2,created,hidden,opening hours for all 7 days; valid US phone number,,1,no");
  assert.equal(lines[2], "3,R3,created,hidden,,,1,no");
  assert.equal(lines[3], "4,R4,skipped_duplicate,,,dup,,no");
});

test("check CSV predicts hidden + missing for importable rows only", () => {
  const csv = validationCsv([
    v(2, "valid", { missing: ["hours"] }),
    v(3, "valid", { missing: [] }),
    v(4, "error", { missing: [] }),
  ]);
  const lines = csv.replace("\ufeff", "").trim().split("\r\n");
  assert.equal(lines[0], "row,name,status,problems,needs_geocoding,will_be,missing");
  assert.equal(lines[1], "2,R2,valid,,no,hidden,opening hours for all 7 days");
  assert.equal(lines[2], "3,R3,valid,,no,hidden,");
  assert.equal(lines[3], "4,R4,error,,no,,");
});
