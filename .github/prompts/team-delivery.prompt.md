---
name: "Team Delivery Runbook"
description: "Use when you want a coordinated software team workflow: plan, implement, QA review, and final delivery summary."
argument-hint: "Describe the feature, bug, or refactor request"
agent: "Dev Team Lead"
---
Run a full team delivery workflow for this request.

Inputs:
- User request: {{input}}

Process requirements:
1. Translate the request into clear acceptance criteria.
2. Delegate implementation work and require minimal diffs.
3. Delegate QA review with severity-ranked findings.
4. Return final status with completed work, validation, and open risks.

Output requirements:
- Scope and acceptance criteria
- Implementation summary
- QA findings and release recommendation
- Open questions
- Suggested next actions
