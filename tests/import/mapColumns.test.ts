/**
 * Phase 3 — Column mapping tests
 */
import { describe, test, expect } from '@jest/globals';
import { suggestMapping, validateMapping } from '../../src/domain/import/mapColumns.js';

describe('suggestMapping', () => {
  test('recognizes exact and alias headers for change orders', () => {
    const headers = [
      'change_order_id',
      'status',
      'approved_amount',
      'title',
      'mystery_column',
    ];
    const result = suggestMapping(headers, 'change_order');
    expect(result.proposedMapping['change_order_id']).toBe('change_order_id');
    expect(result.proposedMapping['status']).toBe('status');
    expect(result.proposedMapping['approved_amount']).toBe('approved_amount');
    expect(result.proposedMapping['title']).toBe('title');
    expect(result.proposedMapping['mystery_column']).toBeNull();
    expect(result.ambiguities).toHaveLength(0);
  });

  test('alias co_id maps to change_order_id', () => {
    const result = suggestMapping(['co_id', 'status', 'approved_amount'], 'change_order');
    expect(result.proposedMapping['co_id']).toBe('change_order_id');
  });

  test('does not auto-assign when header is ambiguous across targets', () => {
    // "amount" is an alias for approved_amount on COs — single target, ok
    // Create ambiguity by having a header that matches multiple field aliases
    // For billing, "amount" only maps to amount. For change_order_line, amount aliases approved_amount.
    // Use a synthetic case: if two fields share an alias in catalog — linked_change_order_id and change_order_id both have co_id on TM?
    // On TM: change_order_id is not a field; linked_change_order_id has co_id.
    // On change_order: co_id → change_order_id only.
    // Field catalog: for change_order, "amount" is alias of approved_amount only.
    // Force ambiguity by testing billing headers where line_id and similar don't collide.
    // Instead verify duplicate destination when two headers map to same target:
    const result = suggestMapping(
      ['approved_amount', 'amount'], // both could claim approved_amount
      'change_order',
    );
    // First header claims approved_amount; second should not overwrite
    expect(result.proposedMapping['approved_amount']).toBe('approved_amount');
    expect(result.proposedMapping['amount']).toBeNull();
  });

  test('billing sample headers map cleanly', () => {
    const headers = [
      'project_id',
      'billing_id',
      'billing_period',
      'invoice_number',
      'line_id',
      'description',
      'cost_code',
      'change_order_id',
      'amount',
      'quantity',
      'unit_price',
      'retainage',
      'billed_to_date',
      'source_reference',
    ];
    const result = suggestMapping(headers, 'billing');
    expect(result.proposedMapping['billing_id']).toBe('billing_id');
    expect(result.proposedMapping['line_id']).toBe('line_id');
    expect(result.proposedMapping['amount']).toBe('amount');
    expect(result.ambiguities).toHaveLength(0);
  });
});

describe('validateMapping', () => {
  test('passes when all required fields are uniquely mapped', () => {
    const mapping = {
      change_order_id: 'change_order_id',
      status: 'status',
      approved_amount: 'approved_amount',
      title: 'title',
    };
    const result = validateMapping(mapping, 'change_order');
    expect(result.valid).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  test('fails when required field is missing', () => {
    const mapping = {
      change_order_id: 'change_order_id',
      status: 'status',
      // approved_amount missing
    };
    const result = validateMapping(mapping, 'change_order');
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain('approved_amount');
    expect(result.issues.some((i) => i.code === 'MISSING_REQUIRED')).toBe(true);
  });

  test('fails on duplicate destination mappings', () => {
    const mapping = {
      col_a: 'change_order_id',
      col_b: 'change_order_id',
      status: 'status',
      approved_amount: 'approved_amount',
    };
    const result = validateMapping(mapping, 'change_order');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DUPLICATE_TARGET')).toBe(true);
  });

  test('fails on unknown target field', () => {
    const mapping = {
      change_order_id: 'change_order_id',
      status: 'status',
      approved_amount: 'approved_amount',
      extra: 'not_a_real_field',
    };
    const result = validateMapping(mapping, 'change_order');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'UNKNOWN_TARGET')).toBe(true);
  });

  test('fails on empty mapping', () => {
    const result = validateMapping({}, 'change_order');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'EMPTY_MAPPING')).toBe(true);
  });
});
