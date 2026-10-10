# 15 — Concise Implementation Plan

**Prerequisite:** All documentation in `docs/`, schemas, prompts, sample data, `AGENTS.md`, and `README.md` are complete and consistent.

## Plan Summary

| Phase | Deliverable | Est. Focus |
|-------|-------------|------------|
| 1 | Auth + Workspace + Project foundation | Data model, NextAuth/Auth.js, RBAC middleware |
| 2 | File upload + object storage | Document entity, signed URLs |
| 3 | CSV/XLSX ingestion | Parser, mapping API, RawRecord |
| 4 | Normalization + validation | Zod schemas, provenance, warnings |
| 5 | Core detection engine | Matching + RULE 001–010 + unit tests |
| 6 | Findings persistence | Finding model, severity scorer, AuditRun |
| 7 | Dashboard + Findings UI | Metrics, list, detail, status actions |
| 8 | Evidence / source viewer | Link to source row/page |
| 9 | PDF + CSV reporting | Report generator |
| 10 | PDF text extraction | Feed into same import pipeline |
| 11 | AI-assisted extraction | Prompts, structured JSON, human confirm |
| 12 | Hardening | Synthetic ground-truth, false-positive suite, isolation tests |

## Immediate Next Steps (After Blueprint)

1. Initialize Next.js + TypeScript project with PostgreSQL (Prisma or Drizzle).
2. Implement Phase 1 only — do not skip ahead.
3. After each phase: run tests, update docs if behavior changed.
4. Use `data/samples/` as the continuous integration fixture from Phase 5 onward.

## Success Gate

MVP is done when the synthetic project produces exactly the findings in `expected_findings.json` (and does not produce the `must_not_flag` cases) and a non-technical user can complete the upload → findings → export path without training.

## Out of Scope Reminder

No live integrations, no mobile, no payroll/CRM/accounting, no AI-invented financial numbers.
