# 14 — Acceptance Criteria (v1.0)

**Spec version:** 1.0.0  
**Oracle:** `data/samples/expected_findings.json`  
**Plan:** [17-implementation-plan-v1.md](17-implementation-plan-v1.md)

## Engine (blocking)

1. AuditEngine on the synthetic project with `as_of_date=2025-08-15` produces **exactly** the primary findings listed in `expected_findings.json` (same rule + entity keys; amounts within $0.01).
2. No unexpected primary findings.
3. Dashboard buckets: Potential Underbilling, Potential Overbilling, Evidence/Dispute Exposure, Data Quality — CO-019 counted once.
4. Every monetary finding includes related record IDs, calculation, calculation_json, confidence, financial_direction, amount_signed.
5. Adversarial false-positive suite passes (grace, credits, retainage, non-billable T&M, progressive billing, lump-sum exclusions, cancelled COs).
6. No LLM call invents or overrides monetary findings.
7. Tenant isolation tests pass.

## Product path (blocking)

1. User can register/login and create a project in a workspace.
2. User can upload sample CSVs, map columns, and commit normalization.
3. User can run an audit with an as-of date.
4. User can view findings list and detail (provenance visible).
5. User can change finding status (events recorded).
6. User can export findings as CSV.

## Non-blocking for v1.0

PDF extraction, AI extraction, PDF reports, live integrations, mobile, multi-currency.
