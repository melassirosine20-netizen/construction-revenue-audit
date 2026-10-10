# Specification Version 1.0 — FROZEN

**Status:** APPROVED FOR IMPLEMENTATION  
**Version:** 1.0.0  
**Frozen date:** 2026-10-08  

## What is frozen

The following documents and fixtures constitute the **authoritative v1.0 specification**. Implementation must conform to them. Do not invent new business rules, financial formulas, fields, or workflows.

| Artifact | Role |
|----------|------|
| `docs/00-product-overview.md` | Product positioning |
| `docs/01-mvp-scope.md` | In / out of scope (see also this freeze for MVP cut) |
| `docs/02-data-model.md` | Entities, provenance, billability, lines, matching, findings |
| `docs/03-detection-rules.md` | RULE 001–010, matching hierarchy, precedence, exclusions |
| `docs/04-findings-taxonomy.md` | Types, financial_direction, status, grouping |
| `docs/05-severity-scoring.md` | Score formula |
| `docs/06-import-workflow.md` | Upload → map → validate → audit |
| `docs/09-security.md` | Auth, isolation |
| `docs/10-architecture.md` | Stack principles (updated by implementation plan) |
| `docs/16-blueprint-fixes.md` | Change log of financial hardening |
| `schemas/*.json` | Machine-readable field contracts |
| `data/samples/*` | Synthetic ground truth |
| `data/samples/expected_findings.json` | Acceptance oracle for audit engine |

## MVP cut (v1.0 critical path)

**In scope for first shippable prototype:**

```
CSV upload → column mapping → validation/normalization → matching
→ deterministic audit rules → findings → finding detail/provenance → CSV export
```

**Explicitly deferred (not in v1.0 critical path):**

- PDF upload / PDF text extraction
- AI-assisted document extraction
- XLSX (may share CSV path later; not required for first gate)
- Live integrations (Procore, accounting systems)
- Mobile apps
- Advanced reporting / PDF report generation beyond CSV export
- Multi-currency
- Full EvidenceLink UI (store links if present; rich viewer later)
- Workspace-configurable materiality UI (use defaults; config table ok)

## Change control

If implementation discovers an ambiguity or contradiction in the frozen spec:

1. **STOP**
2. Report the ambiguity with exact doc references
3. Do **not** invent a silent resolution

Amendments require a new minor version (1.1, …) and an entry in `docs/16-blueprint-fixes.md`.
