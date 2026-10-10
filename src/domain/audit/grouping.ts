/**
 * Finding grouping & de-duplication logic
 * Spec: docs/03-detection-rules.md § Rule Precedence & De-duplication
 *
 * Rules:
 * 1. More specific wins for primary classification:
 *    - Quantity mismatch → RULE 007 is primary; RULE 002 may be linked as related
 *    - Rate mismatch → RULE 008 is primary; RULE 002 may be linked as related
 *    - Duplicate invoice → RULE 009 is primary; RULE 002 OVERBILLED is linked as related
 * 2. Store related_finding_ids on both findings.
 * 3. Dashboard economic totals count the GROUPED amount once.
 * 4. RULE 002 still runs for pure header-level partial billing (e.g. CO-007 lump-sum partial bill).
 *
 * RULE 006 is DATA_QUALITY — NOT included in underbilling dashboard bucket.
 *
 * Dashboard buckets (spec: docs/02-data-model.md § Amount Accounting):
 *   Underbilling:    sum of positive amount_signed where direction = UNDERBILLED
 *                   EXCLUDING findings that are "related" (secondary) to more specific rules
 *   Overbilling:    absolute value of primary OVERBILLED findings only (CO-019 counted ONCE)
 *   Evidence Risk:  amount_at_risk of EVIDENCE_RISK findings
 *   Data Quality:   count (+ optional $) of DATA_QUALITY findings
 */
import type { FindingDraft, DashboardBuckets } from '../types.js';

/** Ref format: "RULE_XXX:entity_id" */
type FindingRef = string;

/**
 * Resolve relatedFindingRefs (which are symbolic like "RULE_009:CO-019") into
 * actual finding indices, and set up bidirectional links.
 *
 * Also marks "secondary" findings — those that are shadowed by a more specific rule
 * on the same economic event.
 */
export interface GroupedFinding extends FindingDraft {
  /** Resolved indices into the findings array (for persistence to set actual UUIDs) */
  resolvedRelatedIndices: number[];
  /**
   * True if this finding is the SECONDARY party in a primary/secondary pair.
   * Secondary findings are persisted but excluded from dashboard economic totals.
   */
  isSecondaryInGroup: boolean;
}

export function groupFindings(findings: FindingDraft[]): GroupedFinding[] {
  // Build a lookup: "RULE_XXX:entity_id" → index in array
  const refIndex = new Map<FindingRef, number>();
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    // Primary ref key for each finding
    const entityId = getEntityId(f);
    if (entityId) {
      refIndex.set(`${f.rule}:${entityId}`, i);
    }
  }

  const grouped: GroupedFinding[] = findings.map((f) => ({
    ...f,
    resolvedRelatedIndices: [],
    isSecondaryInGroup: false,
  }));

  // Resolve refs and mark secondary findings
  for (let i = 0; i < grouped.length; i++) {
    const gf = grouped[i];
    for (const ref of gf.relatedFindingRefs) {
      const targetIdx = refIndex.get(ref);
      if (targetIdx !== undefined && targetIdx !== i) {
        gf.resolvedRelatedIndices.push(targetIdx);
        // Bidirectional link
        if (!grouped[targetIdx].resolvedRelatedIndices.includes(i)) {
          grouped[targetIdx].resolvedRelatedIndices.push(i);
        }
      }
    }
  }

  // Mark RULE 002 as secondary when a more specific rule explains the same CO variance
  // Precedence pairs:
  //   RULE 009 (DUPLICATE/OVERBILLED) → RULE 002 (OVERBILLED) for same CO = 009 is primary
  //   RULE 007 (QUANTITY_MISMATCH)    → RULE 002 (UNDERBILLED) for same CO = 007 is primary
  //   RULE 008 (RATE_MISMATCH)        → RULE 002 (UNDERBILLED) for same CO = 008 is primary
  for (let i = 0; i < grouped.length; i++) {
    const gf = grouped[i];
    if (gf.rule !== 'RULE_002') continue;

    // Check if any related finding is a more specific rule
    for (const relIdx of gf.resolvedRelatedIndices) {
      const related = grouped[relIdx];
      if (
        related.rule === 'RULE_007' ||
        related.rule === 'RULE_008' ||
        related.rule === 'RULE_009'
      ) {
        // RULE 002 is secondary
        grouped[i] = { ...gf, isSecondaryInGroup: true };
        break;
      }
    }
  }

  return grouped;
}

/**
 * Compute dashboard bucket totals from grouped findings.
 * Excludes secondary findings from economic totals.
 * RULE 006 (DATA_QUALITY) is NOT included in underbilling bucket.
 */
export function computeDashboardBuckets(findings: GroupedFinding[]): DashboardBuckets {
  let potentialUnderbilling = 0;
  let potentialOverbilling = 0;
  let evidenceDisputeExposure = 0;
  let dataQualityCount = 0;

  for (const f of findings) {
    // Secondary findings excluded from economic totals
    if (f.isSecondaryInGroup) continue;

    // RULE 005 is INFO/NONE — excluded from all buckets
    if (f.rule === 'RULE_005') continue;

    switch (f.financialDirection) {
      case 'UNDERBILLED':
        if (f.amountSigned !== null && f.amountSigned > 0) {
          potentialUnderbilling += f.amountSigned;
        }
        break;
      case 'OVERBILLED':
        if (f.amountAtRisk > 0) {
          potentialOverbilling += f.amountAtRisk;
        }
        break;
      case 'EVIDENCE_RISK':
        evidenceDisputeExposure += f.amountAtRisk;
        break;
      case 'DATA_QUALITY':
      case 'NONE':
        dataQualityCount++;
        break;
    }
  }

  return {
    potentialUnderbilling: Math.round(potentialUnderbilling * 100) / 100,
    potentialOverbilling: Math.round(potentialOverbilling * 100) / 100,
    evidenceDisputeExposure: Math.round(evidenceDisputeExposure * 100) / 100,
    dataQualityCount,
  };
}

/** Extract the primary entity ID from a finding for building ref keys */
function getEntityId(f: FindingDraft): string | null {
  // Look for the most specific related record
  const coRecord = f.relatedRecords.find((r) => r.type === 'change_order');
  if (coRecord) return coRecord.id;

  const ticketRecord = f.relatedRecords.find((r) => r.type === 'tm_ticket');
  if (ticketRecord) return ticketRecord.id;

  return null;
}
