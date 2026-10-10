/**
 * RULE 001 — Approved CO Not Billed
 * Spec: docs/03-detection-rules.md § RULE 001
 *
 * Condition:
 *  - CO status = approved
 *  - Sum of linked BillingItem.amount = 0 (or no matches)
 *  - |approved_amount| ≥ materiality
 *  - as_of_date ≥ (expected_bill_after OR approved_date + grace days)
 */
import type {
  AuditSnapshot,
  FindingDraft,
  ChangeOrder,
} from '../../types.js';
import { isMaterial } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

/** Add days to an ISO date string, return new ISO date string */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00Z');
}

export function runRule001(snapshot: AuditSnapshot): FindingDraft[] {
  const { changeOrders, billingItems, settings, asOfDate } = snapshot;
  const findings: FindingDraft[] = [];

  const asOf = parseDate(asOfDate);

  for (const co of changeOrders) {
    // Must be approved
    if (co.status !== 'approved') continue;

    // Credit COs (negative amount) are intentional — RULE 001 is for revenue at risk
    if (co.approvedAmount <= 0) continue;

    // Materiality check
    if (!isMaterial(co.approvedAmount, settings, co.approvedAmount)) continue;

    // Sum linked billing
    const linked = billingItems.filter(
      (b) => b.changeOrderId === co.changeOrderId,
    );
    const billedTotal = linked.reduce((sum, b) => sum + b.amount, 0);

    // RULE 001: billed total must be 0 (or no billing at all)
    if (billedTotal !== 0) continue;

    // Grace / expected_bill_after check
    const billingCutoff = co.expectedBillAfter
      ? parseDate(co.expectedBillAfter)
      : co.approvedDate
      ? parseDate(addDays(co.approvedDate, settings.billingGraceDays))
      : null;

    if (!billingCutoff) continue; // Cannot determine cutoff without approved_date
    if (asOf < billingCutoff) continue; // Still within grace period

    const amountSigned = co.approvedAmount;
    const amountAtRisk = co.approvedAmount;

    findings.push({
      rule: 'RULE_001',
      findingType: 'REVENUE_AT_RISK',
      financialDirection: 'UNDERBILLED',
      severity: scoreSeverity(amountAtRisk, 'UNDERBILLED'),
      confidence: 'HIGH',
      relatedRecords: [{ type: 'change_order', id: co.changeOrderId }],
      relatedFindingRefs: [],
      amountSigned,
      amountAtRisk,
      calculation:
        `Change Order ${co.changeOrderId} is approved at $${co.approvedAmount.toFixed(2)}. ` +
        `No billing records are linked as of audit cutoff ${asOfDate}. ` +
        `Potential unbilled amount: $${amountSigned.toFixed(2)}.`,
      calculationJson: {
        rule: 'RULE_001',
        operands: {
          change_order_id: co.changeOrderId,
          approved_amount: co.approvedAmount,
          billed_amount: 0,
          as_of_date: asOfDate,
          billing_cutoff: billingCutoff.toISOString().slice(0, 10),
          grace_days: settings.billingGraceDays,
        },
        formula: 'amount_signed = approved_amount (billed_amount = 0)',
        result: amountSigned,
      },
      explanation:
        `Approved CO ${co.changeOrderId} has $0 billed as of ${asOfDate}, ` +
        `more than ${settings.billingGraceDays} days after approval. ` +
        `Full approved amount of $${co.approvedAmount.toFixed(2)} is potentially at risk.`,
    });
  }

  return findings;
}
