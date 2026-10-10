/**
 * Phase 3 — Coercion + normalization tests
 * Uses sample CSVs where appropriate. Does not touch AuditEngine.
 */
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { coerceMoney, coerceDate, coerceEnum, coerceNumber } from '../../src/domain/import/coerce.js';
import { suggestMapping } from '../../src/domain/import/mapColumns.js';
import { normalizeRows } from '../../src/domain/import/normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(__dirname, '../../data/samples');

function readSample(name: string): Record<string, string>[] {
  const content = readFileSync(join(samplesDir, name), 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

describe('coerceMoney', () => {
  test('parses plain decimals and currency symbols', () => {
    expect(coerceMoney('4800.00', { required: true, field: 'amount' })).toEqual({
      ok: true,
      value: 4800,
    });
    expect(coerceMoney('$1,200.50', { required: true, field: 'amount' })).toEqual({
      ok: true,
      value: 1200.5,
    });
  });

  test('parses negative and accounting parentheses', () => {
    expect(coerceMoney('(100.00)', { required: true, field: 'amount' })).toEqual({
      ok: true,
      value: -100,
    });
    expect(coerceMoney('-50', { required: true, field: 'amount' })).toEqual({
      ok: true,
      value: -50,
    });
  });

  test('does not coerce invalid money to zero', () => {
    const r = coerceMoney('not-a-number', { required: true, field: 'amount' });
    expect(r.ok).toBe(false);
  });

  test('empty optional returns null, empty required fails', () => {
    expect(coerceMoney('', { required: false, field: 'amount' })).toEqual({
      ok: true,
      value: null,
    });
    expect(coerceMoney('', { required: true, field: 'amount' }).ok).toBe(false);
  });
});

describe('coerceDate', () => {
  test('accepts ISO and US formats', () => {
    expect(coerceDate('2025-03-12', { required: true, field: 'd' })).toEqual({
      ok: true,
      value: '2025-03-12',
    });
    expect(coerceDate('3/12/2025', { required: true, field: 'd' })).toEqual({
      ok: true,
      value: '2025-03-12',
    });
  });

  test('rejects garbage dates', () => {
    expect(coerceDate('not-a-date', { required: true, field: 'd' }).ok).toBe(false);
  });
});

describe('coerceEnum', () => {
  test('accepts case-insensitive valid values', () => {
    const r = coerceEnum('Approved', {
      required: true,
      field: 'status',
      values: ['submitted', 'approved', 'rejected'],
    });
    expect(r).toEqual({ ok: true, value: 'approved' });
  });

  test('rejects invalid enum', () => {
    const r = coerceEnum('maybe', {
      required: true,
      field: 'status',
      values: ['submitted', 'approved'],
    });
    expect(r.ok).toBe(false);
  });
});

describe('normalizeRows — change orders sample', () => {
  test('normalizes change_orders.csv with provenance', () => {
    const rows = readSample('change_orders.csv');
    const headers = Object.keys(rows[0]);
    const { proposedMapping } = suggestMapping(headers, 'change_order');

    const result = normalizeRows(
      {
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sourceDocumentId: 'doc-1',
        sourceImportId: 'imp-1',
        documentType: 'change_order',
        entityKind: 'change_order',
        mapping: proposedMapping,
      },
      rows.map((rawPayload, i) => ({ sourceRow: i + 2, rawPayload })),
    );

    expect(result.successCount).toBeGreaterThan(0);
    expect(result.errorCount).toBe(0);
    const first = result.entities[0];
    expect(first.kind).toBe('change_order');
    if (first.kind !== 'change_order') return;
    expect(first.entity.changeOrderId).toBeTruthy();
    expect(first.entity.sourceDocumentId).toBe('doc-1');
    expect(first.entity.sourceImportId).toBe('imp-1');
    expect(first.entity.sourceRowOrPage).toBe('2');
    expect(first.entity.rawValues).toBeDefined();
    expect(typeof first.entity.approvedAmount).toBe('number');
    expect(first.entity.changeOrderId.startsWith('CO-')).toBe(true);
  });

  test('row with invalid approved_amount fails without inventing zero', () => {
    const result = normalizeRows(
      {
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sourceDocumentId: 'doc-1',
        sourceImportId: 'imp-1',
        documentType: 'change_order',
        entityKind: 'change_order',
        mapping: {
          change_order_id: 'change_order_id',
          status: 'status',
          approved_amount: 'approved_amount',
        },
      },
      [
        {
          sourceRow: 2,
          rawPayload: {
            change_order_id: 'CO-X',
            status: 'approved',
            approved_amount: 'N/A',
          },
        },
      ],
    );
    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(result.warnings.some((w) => w.code === 'INVALID_MONEY')).toBe(true);
    expect(result.entities).toHaveLength(0);
  });

  test('invalid enum on required status fails the row', () => {
    const result = normalizeRows(
      {
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sourceDocumentId: 'doc-1',
        sourceImportId: 'imp-1',
        documentType: 'change_order',
        entityKind: 'change_order',
        mapping: {
          change_order_id: 'change_order_id',
          status: 'status',
          approved_amount: 'approved_amount',
        },
      },
      [
        {
          sourceRow: 2,
          rawPayload: {
            change_order_id: 'CO-X',
            status: 'pending_review',
            approved_amount: '100',
          },
        },
      ],
    );
    expect(result.successCount).toBe(0);
    expect(result.warnings.some((w) => w.code === 'INVALID_ENUM')).toBe(true);
  });
});

describe('normalizeRows — billing + tm samples', () => {
  test('normalizes billing.csv keeping line_id as string', () => {
    const rows = readSample('billing.csv');
    const headers = Object.keys(rows[0]);
    const { proposedMapping } = suggestMapping(headers, 'billing');
    const result = normalizeRows(
      {
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sourceDocumentId: 'doc-1',
        sourceImportId: 'imp-1',
        documentType: 'billing',
        entityKind: 'billing',
        mapping: proposedMapping,
      },
      rows.map((rawPayload, i) => ({ sourceRow: i + 2, rawPayload })),
    );
    expect(result.successCount).toBeGreaterThan(0);
    const item = result.entities[0];
    expect(item.kind).toBe('billing');
    if (item.kind !== 'billing') return;
    expect(typeof item.entity.lineId).toBe('string');
    expect(item.entity.sourceRowOrPage).toBeTruthy();
  });

  test('normalizes tm_tickets.csv with billable flags', () => {
    const rows = readSample('tm_tickets.csv');
    const headers = Object.keys(rows[0]);
    const { proposedMapping } = suggestMapping(headers, 'tm_ticket');
    const result = normalizeRows(
      {
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sourceDocumentId: 'doc-1',
        sourceImportId: 'imp-1',
        documentType: 'tm_ticket',
        entityKind: 'tm_ticket',
        mapping: proposedMapping,
      },
      rows.map((rawPayload, i) => ({ sourceRow: i + 2, rawPayload })),
    );
    expect(result.successCount).toBeGreaterThan(0);
    const tm = result.entities[0];
    expect(tm.kind).toBe('tm_ticket');
    if (tm.kind !== 'tm_ticket') return;
    expect(tm.entity.ticketId).toBeTruthy();
    expect(['billable', 'non_billable', 'unknown']).toContain(tm.entity.billableStatus);
  });

  test('normalizes contract_sov.csv', () => {
    const rows = readSample('contract_sov.csv');
    const headers = Object.keys(rows[0]);
    const { proposedMapping } = suggestMapping(headers, 'contract_sov');
    const result = normalizeRows(
      {
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sourceDocumentId: 'doc-1',
        sourceImportId: 'imp-1',
        documentType: 'contract_sov',
        entityKind: 'contract_sov',
        mapping: proposedMapping,
      },
      rows.map((rawPayload, i) => ({ sourceRow: i + 2, rawPayload })),
    );
    expect(result.successCount).toBeGreaterThan(0);
    const sov = result.entities[0];
    expect(sov.kind).toBe('contract_sov');
    if (sov.kind !== 'contract_sov') return;
    expect(typeof sov.entity.lineId).toBe('string');
    expect(sov.entity.rawValues).toBeTruthy();
  });
});

describe('coerceNumber optional empty', () => {
  test('optional empty number is null not zero', () => {
    expect(coerceNumber('', { required: false, field: 'q' })).toEqual({
      ok: true,
      value: null,
    });
  });
});
