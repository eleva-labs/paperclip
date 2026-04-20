---
name: eng-impl-plan-review
description: >
  Perform a structured read-only review of an engineering implementation plan and
  produce a formal review document using the shared review contract. Use this
  when a completed plan needs formal acceptance before execution.
---

# Review Implementation Plan

Perform a read-only formal review of an implementation plan.

## When to Use

- After `eng-impl-plan` produces `implementation-plan.md`
- As a required checkpoint for Medium and Large engineering work
- When a human or orchestrating skill explicitly requests plan review

## When NOT to Use

- For research, design, or code review
- To revise the implementation plan directly

## Inputs

- Primary artifact path, usually `{workspace}/implementation-plan.md`
- Workspace path
- Supporting context paths actually needed for the review
- Optional review focus

## Output

- `{workspace}/review-implementation-plan.md`

Use the shared contract in `docs/engineering/templates/review.md`.

## Read Before Reviewing

- `docs/constitution/README.md`
- applicable team constitution or team docs for ownership and boundary checks
- `docs/engineering/templates/implementation-plan.md`
- `docs/engineering/templates/review.md`
- upstream workspace artifacts actually needed, typically `design.md` and optionally `research.md`

## Review Focus

- completeness of intended scope coverage
- template and contract completeness
- upstream alignment
- decomposition quality
- dependency, serial-vs-parallel structure, and execution order sanity
- acceptance criteria quality
- file-manifest and scope integrity
- review strategy and review-point placement
- review readiness and governance fit
- effort realism and execution practicality

## Workflow

1. Confirm the implementation plan under review and minimal supporting context.
2. Read the governing docs, the plan, and the needed upstream context.
3. Evaluate using the shared verdicts and finding categories.
4. Write `{workspace}/review-implementation-plan.md` using the shared contract.
5. Update the workspace `README.md` activity log.
6. Return the verdict summary to the caller.
