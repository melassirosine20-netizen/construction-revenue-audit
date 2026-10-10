# 07 — UI / UX

**Related:** [00-product-overview.md](00-product-overview.md) · [04-findings-taxonomy.md](04-findings-taxonomy.md) · [08-reporting.md](08-reporting.md)

## Design Principles

- Designed for project manager / controller / owner.
- Understandable without training.
- Feels like **financial control software**, not a construction management system and not a generic AI chat app.
- Clean, professional B2B interface.
- Do **not** imitate Procore visually.
- Prioritize financial exceptions over generic construction metrics.

## Primary Navigation

```
Dashboard
Projects
Findings
Imports
Reports
Settings
```

Avoid excessive screens for MVP. The **Findings** screen is the most important.

## Dashboard

Answers these questions:

1. How much potential revenue is exposed?
2. How many findings exist?
3. How much is high-confidence?
4. Which projects have the greatest exposure?
5. Which change orders have billing gaps?
6. Which T&M items have no downstream billing?
7. Which items have weak evidence?

### Example Project Card

```
PROJECT A
Potential revenue exposure:  $42,700
  High confidence:           $21,400
  Medium confidence:         $14,300
  Evidence risk:             $7,000
Open findings:               17
```

Dashboard prioritizes financial exceptions.

## Findings List

- Filterable by project, type, severity, confidence, status, amount range.
- Sortable by amount at risk, severity, date, confidence.
- Each row shows: type badge, severity, amount, confidence, short explanation, status.
- Click → Finding Detail.

## Finding Detail View

Must be fully explainable. Example:

```
Finding: CO-014 — Partial billing

Approved:              $24,800
Billed:                $18,500
Potential difference:  $6,300

Evidence:
  Change Order: CO-014
    Approved: $24,800
  Billing record: INV-2026-084
    Billed: $18,500

Calculation:
  $24,800 − $18,500 = $6,300

Confidence: HIGH
Status: OPEN
```

User must be able to:
- Inspect underlying records
- View source document / row / page
- Change status (accept / dismiss / resolve)
- Add a note
- Trigger recalculation after mapping corrections

## Import Experience

See [06-import-workflow.md](06-import-workflow.md).  
UI must guide the user through the 7 steps with clear progress and validation feedback.

## Projects

Simple list + detail. Project detail shows:
- Summary exposure metrics
- Recent imports
- Open findings count
- Link to run / re-run audit

## Reports

Export buttons for CSV and PDF.  
Preview of executive summary before download.

## Settings

- Workspace name
- Materiality threshold
- User management (basic)
- Notification preferences (optional for MVP)

## Visual Language

- Neutral professional palette (blues / grays / whites)
- Clear numeric hierarchy (large exposure numbers, secondary metrics smaller)
- Severity color coding (CRITICAL = red, HIGH = orange, etc.) with accessible contrast
- Avoid illustration-heavy or “playful” aesthetics
- Dense but scannable tables for findings
