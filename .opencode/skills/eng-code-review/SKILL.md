---
name: eng-code-review
description: >
  Perform a structured read-only formal review of implementation-cycle code changes
  and produce a workspace review document using the shared review contract. Use
  this when a cycle is marked for formal review.
---

# Review Code

Perform a read-only formal review of implementation-cycle code changes.

## When to Use

- When an implementation cycle is marked `formal`
- When Large engineering work reaches a code-review gate
- When Medium engineering work should receive formal code review
- When a human or orchestrating skill explicitly requests implementation-cycle code review

## When NOT to Use

- For research, design, or implementation-plan review
- For broad non-cycle code review with no workspace/process anchor
- To fix the code directly

## Inputs

- Primary code artifact set for one implementation cycle
- Workspace path
- Implementation-plan context for the reviewed cycle
- Supporting context paths actually needed for the review
- Optional review focus

## Output

- `{workspace}/phase-{N}-review.md`

Use the shared contract in `docs/engineering/templates/review.md`.

## Read Before Reviewing

- `docs/constitution/README.md`
- applicable team constitution or team docs when relevant
- `ARCHITECTURE.md` when architecture fit matters
- `docs/engineering/templates/review.md`
- workspace `implementation-plan.md`
- workspace `design.md` and `research.md` when materially relevant
- concise repo standards and patterns relevant to the changed files

## Review Focus

- completeness against cycle scope and acceptance fit
- architecture and pattern fit
- boundary and constitution compliance
- type and schema discipline
- file/folder structure and maintainability
- repo standards and convention conformance
- logging, observability, and safety
- tests and operational confidence

## Workflow

1. Confirm the implementation-cycle scope and supporting context.
2. Read the governing docs, implementation context, changed files, and needed tests/patterns.
3. Evaluate using the shared verdicts and finding categories.
4. Write `{workspace}/phase-{N}-review.md` using the shared contract.
5. Update the workspace `README.md` activity log.
6. Return the verdict summary to the caller.
