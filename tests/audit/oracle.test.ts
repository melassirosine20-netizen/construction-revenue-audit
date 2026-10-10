/**
 * Oracle test suite — ground-truth tests for the AuditEngine
 * Spec: docs/17-implementation-plan-v1.md § E.2 Ground-truth suite (oracle)
 * Spec: docs/14-acceptance-criteria.md § Engine (blocking)
 *
 * MUST PASS before any findings UI is built.
 * DO NOT weaken or remove failing tests.
 *
 * Oracle: data/samples/expected_findings.json
 * as_of_date: 2025-08-15
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll } from '@jest/globals';
import { runAuditEngine } from '../../src/domain/audit/engine.js';
import { buildSampleSnapshot } from '../fixtures/sampleLoader.js';
import type { GroupedFinding } from '../../src/domain/audit/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface OracleFinding {
  rule: string;
  finding_type: string;
  financial_direction: string;
  related_change_order_id?: string;
  related_ticket_id?: string;
  approved_amount?: number;
  billed_amount?: number;
  amount_signed?: number;
  amount_at_risk: number;
  confidence: string;
  must_detect?: boolean;
  notes?: string;
}

interface ExpectedFindingsDoc {
  project_id: string;
  project_name: string;
  description: string;
  materiality_threshold_usd: number;
  audit_as_of_date: string;
  expected_findings: OracleFinding[];
  must_not_flag: Array<Record<string, unknown>>;
  dashboard_totals_expected: {
    potential_underbilling: number;
    potential_overbilling: number;
    evidence_dispute_exposure: number;
    notes: string;
  };
}

const expectedFindings: ExpectedFindingsDoc = JSON.parse(
  readFileSync(join(__dirname, '../../data/samples/expected_findings.json'), 'utf-8'),
);

const AS_OF_DATE = '2025-08-15';
const AMOUNT_TOLERANCE = 0.01; // $0.01

/** Run once and share result across all tests in this file */
let result: ReturnType<typeof runAuditEngine>;
let primaryFindings: GroupedFinding[];

beforeAll(() => {
  const snapshot = buildSampleSnapshot(AS_OF_DATE);
  result = runAuditEngine(snapshot);
  // Primary findings = not secondary (not shadowed by more specific rule)
  primaryFindings = result.findings.filter((f) => !f.isSecondaryInGroup);
});

// ─── E.2.1 expected_findings_match ───────────────────────────────────────────

describe('Oracle: expected findings match', () => {
  const oracle: OracleFinding[] = expectedFindings.expected_findings;

  test('RULE_001 CO-014 — Completely unbilled approved CO', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_001' &&
        f.relatedRecords.some((r) => r.type === 'change_order' && r.id === 'CO-014'),
    );
    expect(finding).toBeDefined();
    expect(finding!.financialDirection).toBe('UNDERBILLED');
    expect(finding!.findingType).toBe('REVENUE_AT_RISK');
    expect(finding!.confidence).toBe('HIGH');
  });

  test('RULE_001 CO-014 amount_signed within $0.01 of 24800', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_001' &&
        f.relatedRecords.some((r) => r.id === 'CO-014'),
    );
    const oracle001 = oracle.find((o) => o.rule === 'RULE_001' && o.related_change_order_id === 'CO-014')!;
    expect(Math.abs((finding!.amountSigned ?? 0) - (oracle001.amount_signed ?? 0))).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
    expect(Math.abs(finding!.amountAtRisk - oracle001.amount_at_risk)).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_002 CO-007 — Partially billed approved CO (underbilled)', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_002' &&
        f.financialDirection === 'UNDERBILLED' &&
        f.relatedRecords.some((r) => r.id === 'CO-007'),
    );
    expect(finding).toBeDefined();
    expect(finding!.findingType).toBe('REVENUE_AT_RISK');
    expect(finding!.confidence).toBe('HIGH');
  });

  test('RULE_002 CO-007 amount_signed within $0.01 of 6300', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_002' &&
        f.financialDirection === 'UNDERBILLED' &&
        f.relatedRecords.some((r) => r.id === 'CO-007'),
    );
    const oracle002u = oracle.find(
      (o) => o.rule === 'RULE_002' && o.financial_direction === 'UNDERBILLED' && o.related_change_order_id === 'CO-007',
    )!;
    expect(Math.abs((finding!.amountSigned ?? 0) - (oracle002u.amount_signed ?? 0))).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_002 CO-019 — Overbilling from duplicate invoices', () => {
    const finding = result.findings.find(
      (f) =>
        f.rule === 'RULE_002' &&
        f.financialDirection === 'OVERBILLED' &&
        f.relatedRecords.some((r) => r.id === 'CO-019'),
    );
    expect(finding).toBeDefined();
    expect(finding!.findingType).toBe('BILLING_MISMATCH');
    expect(finding!.confidence).toBe('HIGH');
  });

  test('RULE_002 CO-019 amount_signed within $0.01 of -11200', () => {
    const finding = result.findings.find(
      (f) =>
        f.rule === 'RULE_002' &&
        f.financialDirection === 'OVERBILLED' &&
        f.relatedRecords.some((r) => r.id === 'CO-019'),
    );
    const oracle002o = oracle.find(
      (o) => o.rule === 'RULE_002' && o.financial_direction === 'OVERBILLED' && o.related_change_order_id === 'CO-019',
    )!;
    expect(Math.abs((finding!.amountSigned ?? 0) - (oracle002o.amount_signed ?? 0))).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_003 TM-042 — Approved billable T&M with no CO and no billing', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_003' &&
        f.relatedRecords.some((r) => r.type === 'tm_ticket' && r.id === 'TM-042'),
    );
    expect(finding).toBeDefined();
    expect(finding!.financialDirection).toBe('UNDERBILLED');
    expect(finding!.findingType).toBe('REVENUE_AT_RISK');
    expect(finding!.confidence).toBe('HIGH');
  });

  test('RULE_003 TM-042 amount within $0.01 of 2645', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_003' &&
        f.relatedRecords.some((r) => r.id === 'TM-042'),
    );
    const oracle003 = oracle.find((o) => o.rule === 'RULE_003' && o.related_ticket_id === 'TM-042')!;
    expect(Math.abs((finding!.amountSigned ?? 0) - (oracle003.amount_signed ?? 0))).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_006 — Contract value reconciliation discrepancy ~$141,000', () => {
    const finding = primaryFindings.find((f) => f.rule === 'RULE_006');
    expect(finding).toBeDefined();
    expect(finding!.financialDirection).toBe('DATA_QUALITY');
    expect(finding!.findingType).toBe('REVENUE_RECONCILIATION');
    expect(finding!.confidence).toBe('HIGH');
    const oracle006 = oracle.find((o) => o.rule === 'RULE_006')!;
    expect(Math.abs(finding!.amountAtRisk - oracle006.amount_at_risk)).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_007 CO-003 — Quantity mismatch 40 LF × $86 = $3,440', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_007' &&
        f.relatedRecords.some((r) => r.id === 'CO-003'),
    );
    expect(finding).toBeDefined();
    expect(finding!.financialDirection).toBe('UNDERBILLED');
    expect(finding!.findingType).toBe('QUANTITY_MISMATCH');
    expect(finding!.confidence).toBe('HIGH');
    const oracle007 = oracle.find((o) => o.rule === 'RULE_007')!;
    expect(Math.abs((finding!.amountSigned ?? 0) - (oracle007.amount_signed ?? 0))).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_008 CO-011 — Rate mismatch $127.50 vs $118.75 × 80 HR = $700', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_008' &&
        f.relatedRecords.some((r) => r.id === 'CO-011'),
    );
    expect(finding).toBeDefined();
    expect(finding!.financialDirection).toBe('UNDERBILLED');
    expect(finding!.findingType).toBe('RATE_MISMATCH');
    expect(finding!.confidence).toBe('HIGH');
    const oracle008 = oracle.find((o) => o.rule === 'RULE_008')!;
    expect(Math.abs((finding!.amountSigned ?? 0) - (oracle008.amount_signed ?? 0))).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_009 CO-019 — Duplicate billing INV-071 + INV-072', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_009' &&
        f.relatedRecords.some((r) => r.id === 'CO-019'),
    );
    expect(finding).toBeDefined();
    expect(finding!.financialDirection).toBe('OVERBILLED');
    expect(finding!.findingType).toBe('DUPLICATE');
    expect(finding!.confidence).toBe('HIGH');
    const oracle009 = oracle.find((o) => o.rule === 'RULE_009')!;
    expect(Math.abs((finding!.amountSigned ?? 0) - (oracle009.amount_signed ?? 0))).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_010 CO-022 — Evidence weakness MEDIUM confidence', () => {
    const finding = primaryFindings.find(
      (f) =>
        f.rule === 'RULE_010' &&
        f.relatedRecords.some((r) => r.id === 'CO-022'),
    );
    expect(finding).toBeDefined();
    expect(finding!.financialDirection).toBe('EVIDENCE_RISK');
    expect(finding!.findingType).toBe('EVIDENCE_RISK');
    expect(finding!.confidence).toBe('MEDIUM');
    const oracle010 = oracle.find((o) => o.rule === 'RULE_010')!;
    expect(Math.abs(finding!.amountAtRisk - oracle010.amount_at_risk)).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });
});

// ─── E.2.2 amounts_match ─────────────────────────────────────────────────────

describe('Oracle: amounts match within $0.01', () => {
  const oracle = expectedFindings.expected_findings;

  test.each(oracle.filter((o) => o.must_detect))(
    'Oracle finding $rule $related_change_order_id amount_at_risk matches',
    (oracleFinding) => {
      // Find the matching finding in primary results
      const match = result.findings.find((f) => {
        if (f.rule !== oracleFinding.rule) return false;
        if (oracleFinding.related_change_order_id) {
          return f.relatedRecords.some((r) => r.id === oracleFinding.related_change_order_id);
        }
        if (oracleFinding.related_ticket_id) {
          return f.relatedRecords.some((r) => r.id === oracleFinding.related_ticket_id);
        }
        return f.rule === oracleFinding.rule;
      });

      expect(match).toBeDefined();
      expect(
        Math.abs(match!.amountAtRisk - oracleFinding.amount_at_risk),
      ).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
    },
  );
});

// ─── E.2.3 directions_match ───────────────────────────────────────────────────

describe('Oracle: financial directions match', () => {
  test('All must_detect findings have correct financial_direction', () => {
    const oracle = expectedFindings.expected_findings.filter((o) => o.must_detect);
    for (const oracleFinding of oracle) {
      const match = result.findings.find((f) => {
        if (f.rule !== oracleFinding.rule) return false;
        if (oracleFinding.related_change_order_id) {
          return f.relatedRecords.some((r) => r.id === oracleFinding.related_change_order_id);
        }
        if (oracleFinding.related_ticket_id) {
          return f.relatedRecords.some((r) => r.id === oracleFinding.related_ticket_id);
        }
        return true;
      });
      expect(match).toBeDefined();
      expect(match!.financialDirection).toBe(oracleFinding.financial_direction);
    }
  });
});

// ─── E.2.4 dashboard_buckets ─────────────────────────────────────────────────

describe('Oracle: dashboard bucket totals', () => {
  const expected = expectedFindings.dashboard_totals_expected;

  test('Potential underbilling matches sum of component findings (CO-014 24800 + CO-007 6300 + TM-042 2645 + CO-003 qty 3440 + CO-011 rate 700 = $37,885)', () => {
    const expectedSum = 24800 + 6300 + 2645 + 3440 + 700; // Exact sum of component findings from oracle notes
    expect(
      Math.abs(result.dashboardBuckets.potentialUnderbilling - expectedSum),
    ).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('Potential overbilling = $11,200 (CO-019 counted once)', () => {
    expect(
      Math.abs(result.dashboardBuckets.potentialOverbilling - expected.potential_overbilling),
    ).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('Evidence/dispute exposure = $4,500 (CO-022)', () => {
    expect(
      Math.abs(result.dashboardBuckets.evidenceDisputeExposure - expected.evidence_dispute_exposure),
    ).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
  });

  test('RULE_006 is NOT in underbilling bucket (DATA_QUALITY)', () => {
    // RULE_006 should NOT add to potentialUnderbilling
    // Verify by checking that underbilling equals exact sum of primary underbilling findings
    const primaryUnderbilling = result.findings
      .filter(
        (f) =>
          !f.isSecondaryInGroup &&
          f.financialDirection === 'UNDERBILLED' &&
          f.amountSigned !== null &&
          f.amountSigned > 0,
      )
      .reduce((sum, f) => sum + (f.amountSigned ?? 0), 0);
    expect(
      Math.abs(result.dashboardBuckets.potentialUnderbilling - primaryUnderbilling),
    ).toBeLessThanOrEqual(AMOUNT_TOLERANCE);
    // And RULE_006 must not be in there
    const rule006 = result.findings.find((f) => f.rule === 'RULE_006');
    expect(rule006?.financialDirection).toBe('DATA_QUALITY');
  });

  test('CO-019 counted once in overbilling (RULE_002 secondary to RULE_009)', () => {
    // RULE_002 OVERBILLED CO-019 should be marked secondary
    const rule002co019 = result.findings.find(
      (f) =>
        f.rule === 'RULE_002' &&
        f.financialDirection === 'OVERBILLED' &&
        f.relatedRecords.some((r) => r.id === 'CO-019'),
    );
    expect(rule002co019?.isSecondaryInGroup).toBe(true);

    // RULE_009 CO-019 should be primary
    const rule009co019 = result.findings.find(
      (f) => f.rule === 'RULE_009' && f.relatedRecords.some((r) => r.id === 'CO-019'),
    );
    expect(rule009co019?.isSecondaryInGroup).toBe(false);
  });
});

// ─── E.2.5 no_extras ─────────────────────────────────────────────────────────

describe('Oracle: no unexpected primary findings', () => {
  /**
   * Expected primary rule/entity pairs (excluding RULE_005 informational and RULE_004 DATA_QUALITY
   * since sample data has no orphan billing CO references).
   */
  const expectedRuleKeys = new Set([
    'RULE_001:CO-014',
    'RULE_002:CO-007',
    'RULE_002:CO-019', // This one is secondary (RULE_009 primary)
    'RULE_003:TM-042',
    'RULE_006', // no entity key
    'RULE_007:CO-003',
    'RULE_008:CO-011',
    'RULE_009:CO-019',
    'RULE_010:CO-022',
  ]);

  test('No unexpected primary revenue/risk findings in results', () => {
    // Filter to revenue-impacting primary findings only (exclude RULE_005 INFO and RULE_004 DATA_QUALITY)
    const revenueFindings = result.findings.filter(
      (f) =>
        !f.isSecondaryInGroup &&
        f.rule !== 'RULE_005' && // informational
        f.rule !== 'RULE_004',   // data quality for orphan billing refs (none in sample)
    );

    for (const f of revenueFindings) {
      let key = f.rule;
      if (f.rule !== 'RULE_006') {
        const entityId =
          f.relatedRecords.find((r) => r.type === 'change_order')?.id ??
          f.relatedRecords.find((r) => r.type === 'tm_ticket')?.id;
        key = entityId ? `${f.rule}:${entityId}` : f.rule;
      }
      expect(expectedRuleKeys).toContain(key);
    }
  });
});

// ─── E.2.6 TM-042 only fires RULE_003 (not other unlinked non-billable) ──────

describe('Oracle: TM-042 only fires RULE_003', () => {
  test('Only TM-042 produces RULE_003 finding (not non_billable or unknown tickets)', () => {
    const rule003findings = result.findings.filter((f) => f.rule === 'RULE_003');
    expect(rule003findings.length).toBe(1);
    expect(rule003findings[0].relatedRecords.some((r) => r.id === 'TM-042')).toBe(true);
  });

  test('Non-billable T&M tickets do not produce RULE_003', () => {
    const nonBillableRule003 = result.findings.filter(
      (f) =>
        f.rule === 'RULE_003' &&
        !f.relatedRecords.some((r) => r.id === 'TM-042'),
    );
    expect(nonBillableRule003).toHaveLength(0);
  });
});
