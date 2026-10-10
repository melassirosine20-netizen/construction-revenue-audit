# 04 — Findings Taxonomy

**Related:** [03-detection-rules.md](03-detection-rules.md) · [05-severity-scoring.md](05-severity-scoring.md) · [02-data-model.md](02-data-model.md)

## Finding Types (Controlled Vocabulary)

| Type | Description |
|------|-------------|
| `REVENUE_AT_RISK` | Potential unbilled or under-billed revenue (UNDERBILLED) |
| `REVENUE_RECONCILIATION` | Contract / SOV / approved-vs-billed discrepancy requiring review |
| `BILLING_MISMATCH` | Billing references wrong/missing CO, or overbilling variance |
| `RATE_MISMATCH` | Approved unit/rate ≠ billed unit/rate |
| `QUANTITY_MISMATCH` | Approved quantity ≠ billed quantity (line-level) |
| `DUPLICATE` | Duplicate invoice / billing of same CO or ticket |
| `EVIDENCE_RISK` | Supporting evidence weaker than policy requires |
| `MISSING_LINK` | Expected linkage (ticket↔CO, CO↔billing) absent |
| `DATA_QUALITY` | Schema / referential / completeness issues |

## Financial Direction (required on every monetary finding)

| Direction | Meaning | Dashboard bucket |
|-----------|---------|------------------|
| `UNDERBILLED` | Approved / billable amount > billed | Potential Underbilling |
| `OVERBILLED` | Billed amount > approved | Potential Overbilling / Correction |
| `EVIDENCE_RISK` | Dispute exposure, not automatic P&L loss | Evidence / Dispute Exposure |
| `DATA_QUALITY` | Data integrity issue | Data Quality Issues (count) |
| `NONE` | Informational only | — |

`amount_signed` is positive for UNDERBILLED, negative for OVERBILLED. `amount_at_risk` is the absolute value for severity bands.

## Status Model

| Status | Meaning |
|--------|---------|
| `OPEN` | Newly created by audit run |
| `REVIEWED` | Human has looked at it |
| `ACCEPTED` | Confirmed as a real issue to act on |
| `DISMISSED` | False positive or not actionable |
| `RESOLVED` | Underlying issue fixed / billed / corrected |

**Immutability rule:** The audit-run snapshot and every `FindingEvent` are immutable. The Finding’s `current_status` is a materialized view of the latest event. Never treat the entire Finding row as write-once.

## Confidence

| Level | When to use |
|-------|-------------|
| `HIGH` | Exact-ID matches, clear arithmetic, complete source fields |
| `MEDIUM` | Strong composite matches, partial evidence, some missing fields |
| `LOW` | Structured-attribute or candidate matches, heavy inference avoided |

## Grouping Related Findings

When multiple rules fire on the same economic event (e.g. RULE 002 OVERBILLED + RULE 009 DUPLICATE on CO-019), store `related_finding_ids` and present a single grouped economic impact on the dashboard.
