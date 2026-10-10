# 16 — Blueprint Fixes (Specification Hardening)

This document records the specification fixes applied after external review so an AI coding agent has a **consistent, computable** target.

## Problems Fixed

| # | Issue | Fix |
|---|-------|-----|
| 1 | RULE 003 would fire on ~35 unlinked T&M tickets | Added `billable_status`, `billing_expected`, `billing_basis`. Only TM-042 is intentional billable unlinked. |
| 2 | RULE 007 not computable (no approved quantity) | Added `change_order_lines.csv` with qty/unit/rate for CO-003 (100 LF @ $86). |
| 3 | RULE 008 not computable (no approved unit price) | CO line + `rate_table.csv` overtime_bill $127.50; billing $118.75 × 80 HR. |
| 4 | RULE 002 treated overbilling same as underbilling | Added `financial_direction` UNDERBILLED / OVERBILLED and signed `amount_signed`. |
| 5 | RULE 002 + RULE 009 double-counted CO-019 | Findings may declare `related_finding_ids`; dashboard groups economic impact. |
| 6 | RULE 006 compared contract to billing-to-date | Rewritten: contract-value reconciliation only (original + approved COs vs revised SOV). Seeded $141k discrepancy is expected. |
| 7 | RULE 005 flagged normal negotiation | Guardrail: informational only; CO-002 in must_not_flag. |
| 8 | RULE 010 required T&M for fixed-price CO | `change_method` + evidence policy table; fixed_price does not require T&M ticket. |
| 9 | Header-only financial model | ChangeOrderLine + RateTable for quantity/rate economics. |
| 10 | Matching underspecified | Four-level matching algorithm with confidence gates; fuzzy never auto-creates HIGH financial findings. |
| 11 | Evidence 1:1 FKs | Evidence + EvidenceLink many-to-many model. |
| 12 | Single “amount at risk” bucket | Dashboard buckets: Underbilling / Overbilling / Evidence / Data Quality. |
| 13 | Severity over-weighted age | Simplified to financial impact + confidence + actionability; age is display-only. |
| 14 | Schema vs CSV type mismatches | `line_id` and `page_reference` are strings; samples normalized. |
| 15 | “Immutable findings” vs status | Finding has `current_status`; history is `FindingEvent`. |
| 16 | No audit cutoff | AuditRun.`as_of_date`; RULE 001/003 respect expected_bill_after + grace. |

## Files Changed / Added

- `docs/02-data-model.md` — full rewrite of entities
- `docs/03-detection-rules.md` — rules + matching + policies
- `docs/04-findings-taxonomy.md` — financial_direction, grouping
- `docs/05-severity-scoring.md` — simplified formula
- `data/samples/change_order_lines.csv` — **new**
- `data/samples/rate_table.csv` — **new**
- `data/samples/change_orders.csv` — change_method, CO-011 aligned
- `data/samples/tm_tickets.csv` — billability fields
- `data/samples/billing.csv` — line_id string, descriptions
- `data/samples/expected_findings.json` — consistent ground truth
- `data/samples/README.md` — updated
- `schemas/*` — aligned with new fields
- `schemas/change-order-line.json`, `evidence-link.json` — **new**

## Still Recommended Before Coding (P1 residual)

- Expand competitive landscape into a real feature matrix (doc 12).
- Prefer a smaller V0 implementation path (CSV → map → 5–6 rules → findings table → export) before PDF/AI extraction.
- Add explicit EvidenceLink sample rows (migration from related_* columns).

## Product Concept Status

**Frozen.** Positioning (independent revenue-protection / audit layer; import-first; deterministic rules; AI does not invent money) remains correct. This pass only made the financial logic trustworthy for implementation.

## Final audit pass (this revision)

- Simulated every rule against sample data; primary findings **exactly match** `expected_findings.json`.
- Tightened RULE 007/008 to exclude lump-sum lines (prevented false positives on CO-019 qty and CO-007 unit-price).
- Tightened RULE 009 to exclude progressive multi-period billing (CO-005 no longer false-positive).
- Added rule precedence: specific (007/008/009) primary; RULE 002 linked when same economic event.
- Set TM-042 `expected_bill_after=2025-08-01` so RULE 003 fires at audit_as_of 2025-08-15.
- Schema validation: 0 errors; FK integrity clean; header/line amounts consistent.
