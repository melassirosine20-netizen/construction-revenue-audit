# 10 — Technical Architecture

**Related:** [01-mvp-scope.md](01-mvp-scope.md) · [09-security.md](09-security.md) · [13-implementation-phases.md](13-implementation-phases.md)

## Guiding Principles

- Simple web application architecture.
- Easy for one developer to maintain.
- No microservices unless genuinely necessary.
- No Python service merely because AI is involved.
- Prefer boring, reliable engineering.
- Clear types, small modules, centralized configuration.
- Validate all external input.
- Handle malformed files gracefully; provide useful user-facing errors.

## Recommended Baseline Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js + TypeScript |
| Backend | Next.js App Router / Route Handlers (or simple TypeScript backend) |
| Database | PostgreSQL |
| Object Storage | S3-compatible or Supabase Storage |
| Validation | Zod |
| Spreadsheet parsing | Reliable XLSX library (e.g. SheetJS / ExcelJS) |
| PDF text extraction | Reliable text extraction library |
| Auth | NextAuth / Auth.js or equivalent |
| Testing | Vitest / Jest + Playwright (or Cypress) for e2e |
| Deployment | Low-cost / free-tier friendly (Vercel + managed Postgres + S3/R2, or equivalent) |

## Logical Layers

```
┌─────────────────────────────────────────────┐
│ UI (Next.js React components)               │
├─────────────────────────────────────────────┤
│ API Route Handlers / Server Actions         │
├─────────────────────────────────────────────┤
│ Domain Services                             │
│  - ImportService                            │
│  - NormalizationService                     │
│  - MatchingService                          │
│  - RuleEngine                               │
│  - FindingService                           │
│  - ReportService                            │
├─────────────────────────────────────────────┤
│ Repositories / Data Access                  │
├─────────────────────────────────────────────┤
│ PostgreSQL  +  Object Storage               │
└─────────────────────────────────────────────┘
```

AI extraction (later phases) is an optional adapter behind the same Normalization / Extraction interfaces; it does not become a separate microservice.

## Key Modules

| Module | Responsibility |
|--------|----------------|
| `import/` | Upload, parse CSV/XLSX, column mapping, raw record persistence |
| `normalize/` | Field coercion, schema validation, provenance stamping |
| `match/` | Record linking (CO ↔ billing, T&M ↔ CO, etc.) |
| `rules/` | Deterministic detection rules (one file or module per rule preferred) |
| `findings/` | Persistence, severity scoring, status lifecycle |
| `reports/` | CSV + PDF generation |
| `auth/` | Authentication & workspace authorization |
| `storage/` | Object storage abstraction |

## Configuration

Centralize:
- Materiality thresholds
- Amount bands for severity
- Rounding tolerances
- Feature flags
- Storage bucket names
- Database connection

Never scatter magic numbers in rule code.

## Database

- PostgreSQL with proper indexes on `workspace_id`, `project_id`, foreign keys, and common filter columns.
- Migrations managed by a standard tool (Prisma, Drizzle, or equivalent).
- Soft deletes where auditability requires retention.

## Testing Architecture

- Unit tests for every detection rule and severity calculation.
- Integration tests for import → normalize → rule run pipeline.
- End-to-end tests for the primary user workflow.
- Synthetic project with known expected findings (see `data/samples/expected_findings.json`).

## Deployment Notes

- Prefer serverless or simple container deployment for cost control.
- Separate staging and production environments.
- Secrets via environment / platform secret store.
- Automated migrations on deploy (with caution and backups).

## Explicit Avoidances

- Microservices for MVP
- Separate Python AI service
- Message queues unless volume demands them
- Over-engineered event sourcing
- Client-side financial calculation as source of truth
