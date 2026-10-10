/**
 * AuditEngine — Pure function: AuditSnapshot → GroupedFinding[]
 * Spec: docs/17-implementation-plan-v1.md § Phase 5
 *
 * CRITICAL:
 *  - No DB calls, no UI, no HTTP, no LLM calls
 *  - Runs from unit tests with zero external dependencies
 *  - Given same snapshot + as_of_date → same findings (deterministic)
 *
 * Rule execution order per spec:
 *   001: Approved CO Not Billed
 *   002: CO Amount Variance
 *   003: Billable T&M with No Billing
 *   004: Billing References Nonexistent CO
 *   005: Submitted vs Approved Variance (informational only)
 *   006: Contract Value Reconciliation
 *   007: Quantity Mismatch
 *   008: Rate Mismatch
 *   009: Duplicate Billing
 *   010: Evidence Weakness
 */
import type { AuditSnapshot, FindingDraft, DashboardBuckets } from '../types.js';
import { runRule001 } from './rules/rule001.js';
import { runRule002 } from './rules/rule002.js';
import { runRule003 } from './rules/rule003.js';
import { runRule004 } from './rules/rule004.js';
import { runRule005 } from './rules/rule005.js';
import { runRule006 } from './rules/rule006.js';
import { runRule007 } from './rules/rule007.js';
import { runRule008 } from './rules/rule008.js';
import { runRule009 } from './rules/rule009.js';
import { runRule010 } from './rules/rule010.js';
import {
  groupFindings,
  computeDashboardBuckets,
  type GroupedFinding,
} from './grouping.js';

export type { GroupedFinding } from './grouping.js';

export interface AuditResult {
  findings: GroupedFinding[];
  dashboardBuckets: DashboardBuckets;
  rulesVersion: string;
  asOfDate: string;
}

/** Current rules version string */
export const RULES_VERSION = '1.0.0';

/**
 * Run the full audit engine on a normalized snapshot.
 * Pure function: no side effects, no I/O.
 *
 * @param snapshot - normalized project data + settings + as_of_date
 * @returns AuditResult with grouped findings and dashboard buckets
 */
export function runAuditEngine(snapshot: AuditSnapshot): AuditResult {
  const allDrafts: FindingDraft[] = [];

  // Execute each rule in order
  allDrafts.push(...runRule001(snapshot));
  allDrafts.push(...runRule002(snapshot));
  allDrafts.push(...runRule003(snapshot));
  allDrafts.push(...runRule004(snapshot));
  allDrafts.push(...runRule005(snapshot)); // informational only
  allDrafts.push(...runRule006(snapshot));
  allDrafts.push(...runRule007(snapshot));
  allDrafts.push(...runRule008(snapshot));
  allDrafts.push(...runRule009(snapshot));
  allDrafts.push(...runRule010(snapshot));

  // Group findings, resolve related refs, mark secondary
  const grouped = groupFindings(allDrafts);

  // Compute dashboard buckets (excluding secondary, excluding RULE 006 from underbilling)
  const dashboardBuckets = computeDashboardBuckets(grouped);

  return {
    findings: grouped,
    dashboardBuckets,
    rulesVersion: RULES_VERSION,
    asOfDate: snapshot.asOfDate,
  };
}
