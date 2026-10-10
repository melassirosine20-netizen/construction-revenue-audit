/**
 * RULE 003 — Billable T&M with No Downstream Billing
 * Spec: docs/03-detection-rules.md § RULE 003
 *
 * Condition:
 *  - T&M approval_status = approved
 *  - total_amount ≥ materiality
 *  - billable_status = billable
 *  - billing_expected ∈ {true, unknown}  — BUT unknown requires HIGH caution
 *  - No matching ChangeOrder AND no matching BillingItem
 *  - as_of_date ≥ (expected_bill_after OR ticket.date + grace)
 *
 * EXPLICIT NON-TRIGGERS (spec-mandated):
 *  - billable_status = non_billable
 *  - billing_expected = false
 *  - Internal work (cleanup, safety, inventory, warranty when non_billable)
 *  - Unlinked T&M with billable_status=unknown → must NOT auto-fire HIGH confidence
 *    (per expected_findings.json § must_not_flag)
 *
 * CRITICAL: Only TM-042 (billable=billable, billing_expected=true) must fire.
 * All unknown billable_status tickets must NOT produce a RULE_003 HIGH finding.
 */
import type { AuditSnapshot, FindingDraft } from '../../types.js';
import { isMaterial } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00Z');
}

export function runRule003(snapshot: AuditSnapshot): FindingDraft[] {
  const { tmTickets, billingItems, changeOrders, settings, asOfDate } = snapshot;
  const findings: FindingDraft[] = [];

  const asOf = parseDate(asOfDate);

  // Index: which CO IDs exist?
  const coIds = new Set(changeOrders.map((c) => c.changeOrderId));

  // Index: which billing items reference a ticket? (for matching by description / ticket ID)
  // Per spec: matching by linked_change_order_id on the ticket, or direct billing reference.
  // For RULE 003, the ticket must have NO linked CO AND no billing item linked to the same CO.
  const billedCoIds = new Set(
    billingItems.filter((b) => b.changeOrderId).map((b) => b.changeOrderId!),
  );

  for (const ticket of tmTickets) {
    // Must be approved
    if (ticket.approvalStatus !== 'approved') continue;

    // CRITICAL non-trigger: non_billable status → never fire
    if (ticket.billableStatus === 'non_billable') continue;

    // CRITICAL non-trigger: billing_expected = false → never fire
    if (ticket.billingExpected === 'false') continue;

    // Per spec and expected_findings.json must_not_flag:
    // "Unlinked T&M with billable_status=unknown should not auto-fire HIGH confidence RULE_003"
    // We only fire with HIGH confidence when billable_status = billable AND billing_expected = true.
    if (ticket.billableStatus !== 'billable') continue;
    if (ticket.billingExpected !== 'true') continue;

    // Materiality
    if (!isMaterial(ticket.totalAmount, settings, ticket.totalAmount)) continue;

    // Must have NO linked change order that exists in the project
    if (
      ticket.linkedChangeOrderId &&
      coIds.has(ticket.linkedChangeOrderId)
    ) {
      continue; // Ticket is linked to a CO — RULE 003 does not apply
    }

    // Must have no billing item linked to the same CO as the ticket
    // (also check: no billing item that references this ticket directly if applicable)
    // For v1.0: if ticket has no linked CO, there cannot be a CO-derived billing link.
    // We additionally check that no billing item shares the ticket's linked_change_order_id.
    if (
      ticket.linkedChangeOrderId &&
      billedCoIds.has(ticket.linkedChangeOrderId)
    ) {
      continue; // Billing exists for the linked CO
    }

    // Grace / cutoff check
    const billingCutoff = ticket.expectedBillAfter
      ? parseDate(ticket.expectedBillAfter)
      : parseDate(addDays(ticket.date, settings.billingGraceDays));

    if (asOf < billingCutoff) continue; // Still within grace period

    const amountSigned = ticket.totalAmount;
    const amountAtRisk = ticket.totalAmount;

    findings.push({
      rule: 'RULE_003',
      findingType: 'REVENUE_AT_RISK',
      financialDirection: 'UNDERBILLED',
      severity: scoreSeverity(amountAtRisk, 'UNDERBILLED'),
      confidence: 'HIGH',
      relatedRecords: [{ type: 'tm_ticket', id: ticket.ticketId }],
      relatedFindingRefs: [],
      amountSigned,
      amountAtRisk,
      calculation:
        `Potentially unbilled T&M work — Ticket ${ticket.ticketId} (${ticket.description}) ` +
        `is marked billable with billing_expected=true and total $${ticket.totalAmount.toFixed(2)}. ` +
        `No linked CO or billing record found as of ${asOfDate}. ` +
        `Potential unbilled amount: $${amountSigned.toFixed(2)}.`,
      calculationJson: {
        rule: 'RULE_003',
        operands: {
          ticket_id: ticket.ticketId,
          total_amount: ticket.totalAmount,
          billable_status: ticket.billableStatus,
          billing_expected: ticket.billingExpected,
          linked_change_order_id: ticket.linkedChangeOrderId,
          expected_bill_after: ticket.expectedBillAfter,
          as_of_date: asOfDate,
          billing_cutoff: billingCutoff.toISOString().slice(0, 10),
        },
        formula: 'amount_signed = total_amount (no linked billing or CO found)',
        result: amountSigned,
      },
      explanation:
        `T&M Ticket ${ticket.ticketId} is approved, marked billable with billing_expected=true, ` +
        `total $${ticket.totalAmount.toFixed(2)}, with no linked change order or billing ` +
        `as of ${asOfDate}. Potential revenue at risk.`,
    });
  }

  return findings;
}
