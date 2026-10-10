# Agent Instructions

> **Spec version: 1.0.0 — FROZEN** (see `docs/00-SPEC-VERSION.md`, `docs/17-implementation-plan-v1.md`).
> Ground-truth sample data and RULE definitions are consistent.
> Do **not** invent quantities, rates, billability, or new business rules.
> Prefer deterministic calculations from explicit fields.
> If the spec is ambiguous, STOP and report — do not invent a resolution.
> MVP critical path: CSV → map → normalize → match → audit rules → findings → detail → CSV export.
> Deferred: PDF/AI extraction, live integrations, advanced reporting.

# AGENTS.md — Instructions for Coding Agents

You are a coding agent working on **Construction Revenue Audit**.

## Mandatory Pre-Work

1. **Read the relevant docs before coding.** Start with:
   - `README.md`
   - `docs/00-product-overview.md`
   - `docs/01-mvp-scope.md`
   - The specific domain doc for the task (data model, rules, architecture, etc.)
2. **Preserve the MVP scope.** Do not invent requirements. Do not expand scope because a competitor has a feature. Do not remove scope because a competitor exists.
3. **Never invent requirements** that are not explicitly stated in the documentation.
4. **Never silently modify financial calculations.** Every monetary finding must be deterministic, traceable, and tested.
5. **Preserve data provenance.** Never overwrite original imported values. Use `raw_value` + `normalized_value` + source references.
6. **Write tests for detection rules.** Every important financial computation must have automated tests.
7. **Run tests after meaningful changes.**
8. **Update documentation when behavior changes.**
9. **Avoid unnecessary dependencies.** Prefer boring, reliable engineering.
10. **Prioritize simple, maintainable code.** Clear types, small modules, no giant files, no magic constants.
11. **Never expose secrets.**
12. **Never use fabricated customer data as real customer evidence.** Synthetic data is for testing only and must be clearly labeled as such.

## Core Engineering Principle (Non-Negotiable)

Separate:

1. Extraction
2. Normalization
3. Deterministic financial rules
4. Evidence linking
5. AI-assisted interpretation

The AI/LLM must **NOT** be trusted to invent financial findings.

**Bad:**
> "AI thinks you may have missed $8,000."

**Good:**
> "Change Order CO-014 is approved at $24,800. The billing dataset contains $18,500 linked to CO-014. Potential difference: $6,300."

Every monetary finding must contain:

- source record IDs
- original values
- normalized values
- calculation
- calculation explanation
- confidence level
- source document reference/page/row where possible

## Implementation Order

Follow the phases in `docs/13-implementation-phases.md`. Do not start with AI. Do not start with integrations. The deterministic audit engine is the heart of the MVP.

## When in Doubt

- Prefer the simpler solution that satisfies the documented requirement.
- Ask for clarification rather than inventing behavior.
- Keep the product feeling like **financial control software**, not a chat app or a construction management system.
