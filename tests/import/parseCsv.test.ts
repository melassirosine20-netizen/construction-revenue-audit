/**
 * Phase 2 — CSV parser unit tests
 * Pure functions; no DB required.
 */
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, MAX_CSV_ROWS } from '../../src/domain/import/parseCsv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(__dirname, '../../data/samples');

describe('parseCsv', () => {
  test('parses sample change_orders.csv with headers and source rows', () => {
    const buf = readFileSync(join(samplesDir, 'change_orders.csv'));
    const result = parseCsv(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.headers).toContain('change_order_id');
    expect(result.data.headers).toContain('approved_amount');
    expect(result.data.rows.length).toBeGreaterThan(0);
    expect(result.data.sourceRows.length).toBe(result.data.rows.length);
    // First data row is source row 2 (row 1 = header)
    expect(result.data.sourceRows[0]).toBe(2);
    // All values are strings
    for (const row of result.data.rows) {
      for (const v of Object.values(row)) {
        expect(typeof v).toBe('string');
      }
    }
  });

  test('parses sample billing.csv', () => {
    const buf = readFileSync(join(samplesDir, 'billing.csv'));
    const result = parseCsv(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.headers).toContain('billing_id');
    expect(result.data.rows.length).toBeGreaterThan(0);
  });

  test('rejects empty content', () => {
    const result = parseCsv('');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY');
  });

  test('rejects header-only with no data rows (still ok, zero rows)', () => {
    const result = parseCsv('a,b,c\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows).toHaveLength(0);
  });

  test('handles BOM and preserves values as strings', () => {
    const withBom = '\uFEFFname,amount\nWidget,12.50\n';
    const result = parseCsv(withBom);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.headers[0]).toBe('name');
    expect(result.data.rows[0].amount).toBe('12.50');
  });

  test('assigns synthetic header names for blank headers', () => {
    const result = parseCsv(',b,\n1,2,3\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.headers[0]).toBe('column_1');
    expect(result.data.headers[2]).toBe('column_3');
  });

  test('skips completely blank data rows but preserves source_row of real rows', () => {
    const csv = 'id,val\n1,a\n\n2,b\n';
    const result = parseCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows).toHaveLength(2);
    // source rows: header=1, first data=2, blank skipped, second data=4
    expect(result.data.sourceRows).toEqual([2, 4]);
  });

  test('rejects oversized row counts', () => {
    const header = 'id\n';
    const body = Array.from({ length: MAX_CSV_ROWS + 2 }, (_, i) => `${i}\n`).join('');
    const result = parseCsv(header + body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TOO_LARGE');
  });
});
