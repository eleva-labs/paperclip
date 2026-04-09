---
name: eng-design-review
description: >
  Perform a structured read-only review of an engineering design artifact and
  produce a formal review document using the shared review contract. Use this
  when a design needs formal acceptance before planning or implementation.
---

# Review Design

Perform a read-only formal review of a design artifact.

## When to Use

- After `eng-design` produces a completed design artifact that needs formal review
- When Medium, Large, or Spike work uses a standalone design and formal review is required or preferred
- When a human or orchestrating skill explicitly requests a design review

## When NOT to Use

- For research, implementation-plan, or code review
- To revise the design directly

## Inputs

- Primary artifact path, usually `{workspace}/design.md`
- Workspace path
- Supporting context paths actually needed for the review
- Optional review focus

## Output

- `{workspace}/review-design.md`

Use the shared contract in `docs/engineering/templates/review.md`.

## Read Before Reviewing

- `docs/constitution/README.md`
- applicable team constitution or team docs for the domains the design touches
- `ARCHITECTURE.md`
- `docs/engineering/templates/design.md`
- `docs/engineering/templates/review.md`
- the design artifact and only the supporting context materially needed

## Review Focus

- completeness for safe planning
- architecture and boundary fit
- contracts, structure, and file-plan quality
- validation strategy
- targeted external-doc validation when relevant
- design-type-appropriate detail when relevant
- decision quality and unresolved risk

## Workflow

1. Confirm the design artifact under review and minimal supporting context.
2. Read the governing docs, the design artifact, and the needed context.
3. Evaluate using the shared verdicts and finding categories.
4. Write `{workspace}/review-design.md` using the shared contract.
5. Update the workspace `README.md` activity log.
6. Return the verdict summary to the caller.
