---
description: "Use when implementing features, fixing bugs, or refactoring with the custom software team agents. Covers planning, implementation quality, and QA release checks."
name: "Dev Team Workflow"
---
# Dev Team Workflow

Use the three-role team model for non-trivial work:

1. Dev Team Lead owns scope, acceptance criteria, and delegation.
2. Implementation Engineer performs minimal, requirement-focused edits.
3. QA Reviewer performs bug and regression review before release.

## Execution Rules

- Define acceptance criteria before editing.
- Prefer the smallest safe diff over broad changes.
- Keep unrelated files untouched.
- Run targeted validation after edits (tests, lint, or build when available).
- For review requests, report findings first, ordered by severity.

## Handoff Quality Bar

Before handoff to QA, include:

- Files changed and why.
- Validation commands run and key outcomes.
- Known limitations or risks.

Before final delivery to user, include:

- What changed.
- Why it satisfies acceptance criteria.
- Any residual risk and suggested next step.
