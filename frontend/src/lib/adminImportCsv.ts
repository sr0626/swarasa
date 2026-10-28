// CSV parsing for the admin bulk import page (/admin/import). Pure and
// dependency-free so it is unit-testable with `node --test`
// (adminImportCsv.test.ts). The file is parsed in the browser; only the
// parsed rows are sent to the API (POST /admin/import/validate).
import type { ImportRowInput } from "../types/adminImport";

export const IMPORT_LIMITS = {
  maxRows: 500,
  maxBytes: 1_000_000,
  /** Cells are cut to this length before sending; the server's per-field limits (<= 1000) then reject over-long ones. */
  maxCell: 2050,
  /** Rows per POST /admin/import/commit request (server cap is 50). */
  chunkSize: 20,
} as const;

/** Columns the importer reads. Others (e.g. owner_email) are ignored. */
export const IMPORT_COLUMNS = [
  "name",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "phone",
  "website",
  "type",
  "description",
  "latitude",
  "longitude",
] as const;

export const REQUIRED_COLUMNS = ["name", "address_line1", "city", "state", "postal_code"] as const;

/** Header-only template (no sample rows: an unedited template must never import fake restaurants). */
export const TEMPLATE_CSV = `${IMPORT_COLUMNS.join(",")}\r\n`;

const HEADER_ALIASES: Record<string, string> = {
  address: "address_line1",
  street: "address_line1",
  address1: "address_line1",
  address2: "address_line2",
  zip: "postal_code",
  zipcode: "postal_code",
  zip_code: "postal_code",
  postal: "postal_code",
  lat: "latitude",
  lng: "longitude",
  lon: "longitude",
  long: "longitude",
  cuisine: "type",
  website_url: "website",
  url: "website",
};

/** Decode bytes as strict UTF-8; null when the file is not valid UTF-8 (e.g. Excel "CSV" in Windows-1252). */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export interface RawCsv {
  records: string[][];
  /** A quoted cell was never closed — the file is malformed. */
  unterminatedQuote: boolean;
}

/** RFC 4180 parser: quoted cells, doubled quotes, embedded commas/newlines, CRLF/LF/CR, leading BOM. */
export function parseCsv(input: string): RawCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStarted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === "" && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      cellStarted = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text.charAt(i + 1) === "\n") i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      cellStarted = false;
    } else {
      cell += c;
      cellStarted = true;
    }
  }
  const unterminatedQuote = inQuotes;
  if (cell !== "" || row.length > 0 || cellStarted) {
    row.push(cell);
    records.push(row);
  }
  return { records, unterminatedQuote };
}

export function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

export type ParseResult =
  | { ok: true; rows: ImportRowInput[]; notices: string[] }
  | { ok: false; error: string };

const KNOWN = new Set<string>(IMPORT_COLUMNS);

/**
 * Turn CSV text into API rows. `row_number` is the record number as a
 * spreadsheet shows it (header = 1, first data row = 2); fully blank records
 * are skipped but still counted. Never throws.
 */
export function parseImportCsv(text: string): ParseResult {
  const { records, unterminatedQuote } = parseCsv(text);
  if (unterminatedQuote) {
    return { ok: false, error: "The file has a quoted value that never closes. Check for a stray quote mark." };
  }
  const header = records[0];
  if (!header) return { ok: false, error: "The file is empty." };

  const columns = header.map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The header row is missing required column(s): ${missing.join(", ")}. Download the template for the exact column names.`,
    };
  }

  const notices: string[] = [];
  const ignored = columns.filter((c) => c !== "" && !KNOWN.has(c));
  if (ignored.includes("owner_email")) {
    notices.push("The owner_email column is ignored: imported listings are unclaimed.");
  }
  const otherIgnored = ignored.filter((c) => c !== "owner_email");
  if (otherIgnored.length > 0) {
    notices.push(`Ignored column(s): ${otherIgnored.join(", ")}.`);
  }
  const dupHeaders = columns.filter((c, i) => c !== "" && columns.indexOf(c) !== i);
  if (dupHeaders.length > 0) {
    return { ok: false, error: `The header row repeats a column: ${Array.from(new Set(dupHeaders)).join(", ")}.` };
  }

  const rows: ImportRowInput[] = [];
  for (let r = 1; r < records.length; r++) {
    const record = records[r];
    if (!record || record.every((c) => c.trim() === "")) continue;
    const row: ImportRowInput = { row_number: r + 1 };
    columns.forEach((col, idx) => {
      if (!KNOWN.has(col)) return;
      const value = (record[idx] ?? "").slice(0, IMPORT_LIMITS.maxCell);
      (row as unknown as Record<string, string | number | null | undefined>)[col] = value.trim() === "" ? null : value;
    });
    rows.push(row);
  }
  if (rows.length === 0) return { ok: false, error: "The file has a header row but no data rows." };
  if (rows.length > IMPORT_LIMITS.maxRows) {
    return {
      ok: false,
      error: `The file has ${rows.length} rows; the limit is ${IMPORT_LIMITS.maxRows}. Split it into smaller files.`,
    };
  }
  return { ok: true, rows, notices };
}

/** Pre-parse size guard (bytes). Returns an error message or null. */
export function checkFileSize(bytes: number): string | null {
  if (bytes === 0) return "The file is empty.";
  if (bytes > IMPORT_LIMITS.maxBytes) {
    return `The file is ${(bytes / 1_000_000).toFixed(1)} MB; the limit is 1 MB.`;
  }
  return null;
}
