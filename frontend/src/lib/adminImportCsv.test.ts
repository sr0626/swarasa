// Unit tests for the admin import CSV parser.  cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  IMPORT_LIMITS,
  TEMPLATE_CSV,
  checkFileSize,
  decodeUtf8,
  parseCsv,
  parseImportCsv,
} from "./adminImportCsv.ts";

const HEADER = "name,address_line1,city,state,postal_code,phone,type";

test("parseCsv handles quotes, doubled quotes, embedded commas and newlines, CRLF and BOM", () => {
  const { records, unterminatedQuote } = parseCsv('﻿a,b\r\n"x, y","say ""hi""\nline2"\r\n');
  assert.equal(unterminatedQuote, false);
  assert.deepEqual(records, [
    ["a", "b"],
    ["x, y", 'say "hi"\nline2'],
  ]);
});

test("parseCsv flags an unterminated quote", () => {
  assert.equal(parseCsv('a,b\n"oops,1\n').unterminatedQuote, true);
});

test("the template is header-only and parses as 'no data rows'", () => {
  const result = parseImportCsv(TEMPLATE_CSV);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no data rows/);
});

test("rows get spreadsheet row numbers (header = 1), blank records skipped but counted", () => {
  const result = parseImportCsv(
    `${HEADER}\nA,1 Main,Plano,TX,75024,,\n,,,,,,\nB,2 Main,Plano,TX,75024,(214) 555-0142,south indian\n`
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(
    result.rows.map((r) => r.row_number),
    [2, 4]
  );
  assert.equal(result.rows[0]?.phone, null);
  assert.equal(result.rows[1]?.type, "south indian");
});

test("header aliases and case/space tolerance", () => {
  const result = parseImportCsv("Name, Address ,City,State,ZIP Code\nA,1 Main,Plano,TX,75024\n");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.rows[0]?.address_line1, "1 Main");
  assert.equal(result.rows[0]?.postal_code, "75024");
});

test("missing required column is a clear file-level error", () => {
  const result = parseImportCsv("name,city\nA,Plano\n");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /postal_code/);
});

test("owner_email is ignored with a notice (imports are unclaimed)", () => {
  const result = parseImportCsv(`${HEADER},owner_email\nA,1 Main,Plano,TX,75024,,,o@x.com\n`);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.notices.some((n) => n.includes("owner_email")));
  assert.equal("owner_email" in (result.rows[0] ?? {}), false);
});

test("repeated header column is rejected", () => {
  const result = parseImportCsv("name,name,address_line1,city,state,postal_code\nA,B,1,P,TX,75024\n");
  assert.equal(result.ok, false);
});

test("row cap and cell truncation", () => {
  const many = Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => `R${i},1 Main,Plano,TX,75024,,`).join(
    "\n"
  );
  const tooMany = parseImportCsv(`${HEADER}\n${many}\n`);
  assert.equal(tooMany.ok, false);

  const long = parseImportCsv(`${HEADER}\n${"x".repeat(5000)},1 Main,Plano,TX,75024,,\n`);
  assert.ok(long.ok);
  if (long.ok) assert.equal(long.rows[0]?.name?.length, IMPORT_LIMITS.maxCell);
});

test("file size guard", () => {
  assert.equal(checkFileSize(0), "The file is empty.");
  assert.equal(checkFileSize(500), null);
  assert.match(checkFileSize(IMPORT_LIMITS.maxBytes + 1) ?? "", /limit is 1 MB/);
});

test("non-UTF-8 bytes decode to null instead of throwing", () => {
  assert.equal(decodeUtf8(new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x20, 0xe9])), null); // 'name é' in Latin-1
  assert.equal(decodeUtf8(new TextEncoder().encode("café")), "café");
});

test("hours is the LAST template column, so older files without it keep working", () => {
  const header = TEMPLATE_CSV.trim().split(",");
  assert.equal(header[header.length - 1], "hours");
  const old = parseImportCsv("name,address_line1,city,state,postal_code\nA,1 Main,Plano,TX,75024\n");
  assert.ok(old.ok);
  if (old.ok) assert.equal(old.rows[0]?.hours, undefined);
});

test("the hours cell is passed through verbatim (the server parses it); alias headers work", () => {
  const cell = "Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed";
  const result = parseImportCsv(
    `name,address_line1,city,state,postal_code,Opening Hours\nA,1 Main,Plano,TX,75024,"${cell}"\nB,2 Main,Plano,TX,75024,\n`
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.rows[0]?.hours, cell);
  assert.equal(result.rows[1]?.hours, null);
});
