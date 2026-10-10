/**
 * RULE 004 — Billing References Nonexistent CO
 * Spec: docs/03-detection-rules.md § RULE 004
 *
 * Condition: BillingItem has a change_order_id that does not exist in the project's CO dataset.
 * Financial direction: DATA_QUALITY
 */
import type { AuditSnapshot, FindingDraft } from '../../types.js';
import { scoreSeverity } from '../severity.js';

export function runRule004(snapshot: AuditSnapshot): FindingDraft[] {
  const { changeOrders, billingItems } = snapshot;
  const findings: FindingDraft[] = [];

  const coIds = new Set(changeOrders.map((c) => c.changeOrderId));

  for (const billing of billingItems) {
    if (!billing.changeOrderId) continue;
    if (coIds.has(billing.changeOrderId)) continue;

    findings.push({
      rule: 'RULE_004',
      findingType: 'DATA_QUALITY',
      financialDirection: 'DATA_QUALITY',
      severity: scoreSeverity(Math.abs(billing.amount), 'DATA_QUALITY'),
      confidence: 'HIGH',
      relatedRecords: [
        { type: 'billing_item', id: billing.billingId },
        { type: 'change_order_id_ref', id: billing.changeOrderId },
      ],
      relatedFindingRefs: [],
      amountSigned: null,
      amountAtRisk: Math.abs(billing.amount),
      calculation:
        `Billing item ${billing.billingId} references CO ${billing.changeOrderId} ` +
        `which does not exist in the project change order dataset.`,
      calculationJson: {
        rule: 'RULE_004',
        operands: {
          billing_id: billing.billingId,
          referenced_co_id: billing.changeOrderId,
          amount: billing.amount,
        },
        formula: 'co_id NOT IN project_change_orders',
        result: 0,
      },
      explanation:
        `Billing item ${billing.billingId} (amount $${billing.amount.toFixed(2)}) ` +
        `references CO ${billing.changeOrderId} which cannot be found in the project. ` +
        `Data quality issue — verify the CO reference.`,
    });
  }

  return findings;
}
