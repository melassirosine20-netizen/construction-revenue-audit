# 08 — Reporting

**Related:** [07-ui-ux.md](07-ui-ux.md) · [04-findings-taxonomy.md](04-findings-taxonomy.md)

## Export Formats (MVP)

1. **CSV** — machine-readable findings and summary metrics
2. **Printer-friendly PDF** — human-readable audit report

## PDF Report Sections

1. **Cover / Header**
   - Workspace name
   - Project name(s)
   - Report generation date
   - Audit run ID / rules version

2. **Executive Summary**
   - Total potential revenue exposure
   - Breakdown by confidence (HIGH / MEDIUM / LOW)
   - Count of open findings by severity
   - Count of evidence-risk items
   - High-level narrative (generated from structured data, not free-form LLM invention)

3. **Potential Revenue Exposure**
   - Table or cards by project
   - Amount at risk by finding type

4. **Findings**
   - Ordered by severity then amount
   - For each finding: type, severity, confidence, amount, explanation, calculation, related records

5. **Evidence**
   - Linked supporting documents / tickets / approvals for findings that have them
   - Note gaps for EVIDENCE_RISK findings

6. **Reconciliation Details**
   - Contract + approved changes vs billed
   - Key variance explanations

7. **Data-Quality Warnings**
   - Import-level and record-level warnings that may affect reliability of the audit

## CSV Export

Minimum columns:

- finding_id
- project_name
- finding_type
- severity
- confidence
- status
- amount_at_risk
- explanation
- calculation
- related_record_ids
- created_at

## Generation Principles

- All numbers come from the same deterministic calculations used in the UI.
- No black-box AI-generated financial claims.
- PDF must be readable when printed on standard letter paper.
- Include page numbers and “Confidential” footer.
