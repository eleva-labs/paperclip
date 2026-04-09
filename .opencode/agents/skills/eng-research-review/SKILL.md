---
name: eng-research-review
description: >
  Perform a structured read-only review of an engineering research artifact and
  produce a formal review document using the shared review contract. Use this
  when research output needs formal acceptance before downstream design or
  implementation decisions proceed.
---

# Review Research

Perform a read-only formal review of a research artifact.

## When to Use

- After `eng-research` produces a completed research artifact that needs formal review
- When Large or Spike work requires research review before acceptance
- When a human or orchestrating skill explicitly requests a research review

## When NOT to Use

- For design, implementation-plan, or code review
- To revise the research artifact directly

## Inputs

- Primary artifact path, usually `{workspace}/research.md`
- Workspace path
- Supporting context paths actually needed for the review
- Optional review focus

## Output

- `{workspace}/review-research.md`

Use the shared contract in `docs/engineering/templates/review.md`.

## Read Before Reviewing

- `docs/constitution/README.md`
- applicable team constitution or team docs when relevant
- `docs/engineering/templates/research.md`
- `docs/engineering/templates/review.md`
- the research artifact and only the supporting context materially needed

## Review Focus

- completeness for downstream use
- research question and scope clarity
- methodology and source transparency
- source quality, including authoritative external docs when relevant
- findings quality and evidence trail
- options analysis quality and alternative coverage
- best-practice / standards awareness when relevant
- recommendation quality
- open questions, risks, and unknowns
- boundary and repo-fit compliance

## Workflow

1. Confirm the artifact under review and minimal supporting context.
2. Read the governing docs, the research artifact, and the needed context.
3. Evaluate using the shared verdicts and finding categories.
4. Write `{workspace}/review-research.md` using the shared contract.
5. Update the workspace `README.md` activity log.
6. Return the verdict summary to the caller.
