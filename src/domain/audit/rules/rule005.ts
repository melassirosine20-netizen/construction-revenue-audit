/**
 * RULE 005 — CO Submitted vs Approved Variance (explanatory/informational)
 * Spec: docs/03-detection-rules.md § RULE 005
 *
 * MVP recommendation from spec: "Implement as informational only, or postpone if it produces noise."
 * Per expected_findings.json must_not_flag: CO-002 ($12,500 → $12,000) is normal negotiation,
 * must NOT create a revenue finding.
 *
 * This implementation: RULE 005 is informational only (NONE direction, INFO severity).
 * It does NOT appear in the oracle expected_findings list so it must NOT contribute to revenue totals.
 */
import type { AuditSnapshot, FindingDraft } from '../../types.js';
import { isMaterial } from '../materiality.js';

export function runRule005(snapshot: AuditSnapshot): FindingDraft[] {
  const { changeOrders, settings } = snapshot;
  const findings: FindingDraft[] = [];

  for (const co of changeOrders) {
    // Skip cancelled/void
    if (co.status === 'cancelled' || co.status === 'void') continue;
    if (co.status === 'rejected') continue; // Also skip — not approved

    const variance = Math.abs(co.originalAmount - co.approvedAmount);
    if (!isMaterial(variance, settings, Math.abs(co.originalAmount))) continue;

    // Informational only — no financial direction, no revenue impact
    findings.push({
      rule: 'RULE_005',
      findingType: 'REVENUE_RECONCILIATION',
      financialDirection: 'NONE',
      severity: 'INFO',
      confidence: 'LOW',
      relatedRecords: [{ type: 'change_order', id: co.changeOrderId }],
      relatedFindingRefs: [],
      amountSigned: null,
      amountAtRisk: variance,
      calculation:
        `CO ${co.changeOrderId}: submitted $${co.originalAmount.toFixed(2)}, ` +
        `approved $${co.approvedAmount.toFixed(2)}, ` +
        `difference $${variance.toFixed(2)} (informational — normal negotiation).`,
      calculationJson: {
        rule: 'RULE_005',
        operands: {
          change_order_id: co.changeOrderId,
          original_amount: co.originalAmount,
          approved_amount: co.approvedAmount,
          variance,
        },
        formula: 'variance = |original_amount - approved_amount| (informational only)',
        result: variance,
      },
      explanation:
        `CO ${co.changeOrderId} submitted at $${co.originalAmount.toFixed(2)} ` +
        `was approved at $${co.approvedAmount.toFixed(2)}. ` +
        `Difference of $${variance.toFixed(2)} is informational — may reflect normal negotiation.`,
    });
  }

  return findings;
}
