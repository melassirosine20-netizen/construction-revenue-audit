# 13 — Implementation Phases

**Related:** [01-mvp-scope.md](01-mvp-scope.md) · [10-architecture.md](10-architecture.md) · [AGENTS.md](../AGENTS.md)

Implement **only after** documentation is complete. Follow this order strictly.

## PHASE 1 — Project / Workspace / Auth Foundation

- Workspace and user models
- Authentication
- Basic authorization (RBAC)
- Project CRUD scoped to workspace

## PHASE 2 — File Upload and Storage

- Document model
- Object storage integration
- Secure upload + signed download URLs
- Document type assignment

## PHASE 3 — CSV / XLSX Ingestion

- Parse spreadsheets
- Column detection
- Mapping UI (API + basic frontend)
- RawRecord persistence

## PHASE 4 — Normalization and Schema Validation

- Coercion of dates, currency, numbers
- Zod (or equivalent) schema validation
- Normalized entity persistence with provenance
- Data-quality warnings

## PHASE 5 — Core Detection Engine

- Record matching (CO ↔ billing, T&M ↔ CO, etc.)
- Deterministic rules RULE 001–010
- Materiality and tolerance configuration
- Unit tests for every rule

## PHASE 6 — Findings Database

- Finding model + FindingEvidence
- Severity scoring
- AuditRun model
- Status lifecycle + ReviewAction

## PHASE 7 — Dashboard / Findings UI

- Dashboard metrics
- Findings list + filters
- Finding detail with calculation transparency
- Status update actions

## PHASE 8 — Evidence / Source Viewer

- Link findings to source documents / rows / pages
- Display raw vs normalized values
- Simple document preview where feasible

## PHASE 9 — PDF Reporting

- Executive summary + findings + evidence sections
- Printer-friendly PDF generation
- CSV export

## PHASE 10 — PDF Text Extraction

- Text-based PDF parsing
- Map extracted tables / fields into the same import pipeline

## PHASE 11 — AI-Assisted Extraction for Messy Documents

- Implement prompts in `/prompts`
- Structured JSON output only
- Human confirmation of mappings still required
- Never let AI invent financial findings

## PHASE 12 — Hardening / Testing

- Full synthetic project ground-truth test
- False-positive suite
- Tenant isolation tests
- Performance & error-handling polish
- Documentation updates

## Rules for Agents

- Do not start with AI (Phase 11).
- Do not start with live integrations.
- The deterministic audit engine (Phase 5) is the heart of the MVP.
- After each phase, run relevant tests and update docs if behavior changed.
