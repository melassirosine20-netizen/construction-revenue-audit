/**
 * Pure CSV parser for import pipeline.
 * Spec: docs/06-import-workflow.md · docs/17-implementation-plan-v1.md § Phase 2
 *
 * Uses csv-parse (already declared). No network, no DB.
 * Preserves every cell as string in the raw payload; coercion happens later in normalization.
 */
import { parse } from 'csv-parse/sync';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** 1-based source row numbers matching the original file (header = row 1) */
  sourceRows: number[];
}

export interface ParseCsvError {
  code: 'EMPTY' | 'NO_HEADERS' | 'PARSE_FAILED' | 'TOO_LARGE' | 'INVALID_ENCODING';
  message: string;
}

export type ParseCsvResult =
  | { ok: true; data: ParsedCsv }
  | { ok: false; error: ParseCsvError };

/** Max rows accepted in a single CSV import (MVP guard). */
export const MAX_CSV_ROWS = 50_000;

/**
 * Parse a UTF-8 CSV buffer/string into header + row objects.
 * Empty lines are skipped. All values are kept as strings for provenance.
 */
export function parseCsv(input: string | Buffer): ParseCsvResult {
  if (input == null) {
    return { ok: false, error: { code: 'EMPTY', message: 'CSV content is empty' } };
  }

  const text = typeof input === 'string' ? input : input.toString('utf8');
  const trimmed = text.replace(/^\uFEFF/, ''); // strip BOM
  if (!trimmed.trim()) {
    return { ok: false, error: { code: 'EMPTY', message: 'CSV content is empty' } };
  }

  let records: string[][];
  try {
    records = parse(trimmed, {
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      cast: false, // keep everything as string
    }) as string[][];
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CSV parse failed';
    return { ok: false, error: { code: 'PARSE_FAILED', message } };
  }

  if (records.length === 0) {
    return { ok: false, error: { code: 'EMPTY', message: 'CSV has no rows' } };
  }

  const headerRow = records[0];
  if (!headerRow || headerRow.every((h) => !h || !String(h).trim())) {
    return { ok: false, error: { code: 'NO_HEADERS', message: 'CSV has no usable header row' } };
  }

  // Deduplicate empty / missing header names so keys remain unique
  const headers = headerRow.map((h, i) => {
    const name = String(h ?? '').trim();
    return name || `column_${i + 1}`;
  });

  if (records.length - 1 > MAX_CSV_ROWS) {
    return {
      ok: false,
      error: {
        code: 'TOO_LARGE',
        message: `CSV exceeds maximum of ${MAX_CSV_ROWS} data rows`,
      },
    };
  }

  const rows: Record<string, string>[] = [];
  const sourceRows: number[] = [];

  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
    // Skip completely blank rows
    if (!cells || cells.every((c) => c == null || String(c).trim() === '')) {
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cells[c] != null ? String(cells[c]) : '';
    }
    rows.push(obj);
    // Header is source row 1; first data row is source row 2
    sourceRows.push(i + 1);
  }

  return { ok: true, data: { headers, rows, sourceRows } };
}
