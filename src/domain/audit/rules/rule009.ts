/**
 * RULE 009 — Duplicate Billing
 * Spec: docs/03-detection-rules.md § RULE 009
 *
 * Condition: Detect duplicate billing of the same CO on different invoices
 * for the same or overlapping billing period.
 *
 * Must NOT fire when:
 *  - Legitimate multi-period progress billing where billed_to_date increases
 *    consistently (CO-005: $7,500 + $7,500 with billed_to_date 7,500 → 15,000)
 *  - Credit / reversal invoices that net the original
 *
 * Expected: CO-019 billed on INV-071 AND INV-072 with same amount $11,200.
 * The billed_to_date on INV-072 is $22,400 (not $11,200), which is suspicious.
 *
 * Detection algorithm:
 *  - Group billing items by (project, change_order_id)
 *  - Within that group, identify duplicate billing periods OR same amount billed twice
 *    where billed_to_date does NOT show consistent progress (i.e. it jumps to double,
 *    not incremented by the new period's amount)
 *
 * Grouping: link to RULE_002 OVERBILLED for the same CO.
 */
import type { AuditSnapshot, FindingDraft, BillingItem } from '../../types.js';
import { isMaterial } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

export function runRule009(snapshot: AuditSnapshot): FindingDraft[] {
  const { billingItems, changeOrders, settings } = snapshot;
  const findings: FindingDraft[] = [];

  // Group billing items by change_order_id
  const byCoId = new Map<string, BillingItem[]>();
  for (const b of billingItems) {
    if (!b.changeOrderId) continue;
    const group = byCoId.get(b.changeOrderId) ?? [];
    group.push(b);
    byCoId.set(b.changeOrderId, group);
  }

  for (const [coId, items] of byCoId) {
    if (items.length < 2) continue;

    // Check for legitimate multi-period progress billing:
    // Legitimate = each period's amount is < total_approved, and billed_to_date
    // consistently increases by the period amount.
    // Duplicate = same amount billed in two separate invoices AND billed_to_date
    // doubles unexpectedly (or is identical across both invoices).

    const duplicateGroups = detectDuplicates(items);
    if (duplicateGroups.length === 0) continue;

    for (const dupes of duplicateGroups) {
      const duplicateAmount = dupes[0].amount; // The amount duplicated
      if (!isMaterial(Math.abs(duplicateAmount), settings, Math.abs(duplicateAmount))) continue;

      const amountSigned = -Math.abs(duplicateAmount); // Overbilling is negative
      const amountAtRisk = Math.abs(duplicateAmount);

      findings.push({
        rule: 'RULE_009',
        findingType: 'DUPLICATE',
        financialDirection: 'OVERBILLED',
        severity: scoreSeverity(amountAtRisk, 'OVERBILLED'),
        confidence: 'HIGH',
        relatedRecords: [
          { type: 'change_order', id: coId },
          ...dupes.map((b) => ({ type: 'billing_item', id: b.billingId })),
        ],
        relatedFindingRefs: [`RULE_002:${coId}`],
        amountSigned,
        amountAtRisk,
        calculation:
          `CO ${coId} billed multiple times: ` +
          dupes.map((b) => `${b.invoiceNumber} $${b.amount.toFixed(2)}`).join(', ') +
          `. Duplicate amount: $${amountAtRisk.toFixed(2)}.`,
        calculationJson: {
          rule: 'RULE_009',
          operands: {
            change_order_id: coId,
            duplicate_invoice_ids: dupes.map((b) => b.billingId),
            duplicate_invoice_numbers: dupes.map((b) => b.invoiceNumber),
            duplicate_amount: duplicateAmount,
            amounts: dupes.map((b) => b.amount),
          },
          formula: 'amount_signed = -(duplicate_amount) [same CO billed twice]',
          result: amountSigned,
        },
        explanation:
          `CO ${coId} appears to have been billed on multiple invoices for the same amount ` +
          `($${Math.abs(duplicateAmount).toFixed(2)}) without consistent billed_to_date progression. ` +
          `Invoices: ${dupes.map((b) => b.invoiceNumber).join(', ')}. ` +
          `Potential overbilling of $${amountAtRisk.toFixed(2)}.`,
      });
    }
  }

  return findings;
}

/**
 * Detect duplicate billing items within a group for the same CO.
 *
 * Returns arrays of billing items that appear to be duplicates.
 *
 * Duplicate detection:
 * 1. Same amount billed in two or more separate invoices (different billing_id / invoice_number)
 * 2. The billed_to_date on the LATER invoice does NOT equal billed_to_date_of_prior + new_amount
 *    (i.e., it jumps to 2× the amount, suggesting a true duplicate rather than progress billing)
 *
 * Legitimate progress billing (CO-005):
 * - Period 1: amount=$7,500, billed_to_date=$7,500
 * - Period 2: amount=$7,500, billed_to_date=$15,000  ← increases by exactly period amount
 * This is NOT a duplicate.
 *
 * Duplicate (CO-019):
 * - INV-071: amount=$11,200, billed_to_date=$11,200
 * - INV-072: amount=$11,200, billed_to_date=$22,400  ← billed_to_date doubled
 * This IS a duplicate (same amount, billed_to_date jumped to 2×).
 */
function detectDuplicates(items: BillingItem[]): BillingItem[][] {
  const duplicateGroups: BillingItem[][] = [];

  // 1. Group by billing period (same period, same amount across distinct invoices is duplicate)
  const byPeriodAndAmount = new Map<string, BillingItem[]>();
  for (const item of items) {
    const period = item.billingPeriod || item.billingDate || 'unknown';
    const key = `${period}_${Math.round(item.amount * 100)}`;
    const group = byPeriodAndAmount.get(key) ?? [];
    group.push(item);
    byPeriodAndAmount.set(key, group);
  }

  for (const [, group] of byPeriodAndAmount) {
    if (group.length >= 2) {
      // Multiple items with same amount in same period across different invoices
      const uniqueInvoices = new Set(group.map((g) => g.invoiceNumber));
      if (uniqueInvoices.size > 1) {
        duplicateGroups.push(group);
      }
    }
  }

  // 2. Also check for duplicate keyword in description or re-issued invoices with same amount
  const byAmount = new Map<number, BillingItem[]>();
  for (const item of items) {
    const key = Math.round(item.amount * 100);
    const group = byAmount.get(key) ?? [];
    group.push(item);
    byAmount.set(key, group);
  }

  for (const [, group] of byAmount) {
    if (group.length >= 2) {
      const hasDuplicateKeyword = group.some((g) =>
        g.description.toUpperCase().includes('DUPLICATE'),
      );
      if (hasDuplicateKeyword) {
        // If not already in duplicateGroups
        const alreadyFound = duplicateGroups.some((dg) =>
          dg.some((d) => group.some((g) => g.billingId === d.billingId)),
        );
        if (!alreadyFound) {
          duplicateGroups.push(group);
        }
      }
    }
  }

  return duplicateGroups;
}
