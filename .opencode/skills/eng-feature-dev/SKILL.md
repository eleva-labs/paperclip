---
name: eng-feature-dev
description: >
  Orchestrate end-to-end feature development: workspace setup, research, design,
  implementation planning, and execute/review/revise cycles. The top-level skill that
  coordinates all eng-* and ops-* skills into a coherent development lifecycle.
  Use this when starting any non-trivial engineering feature.
---

# Feature Development

Orchestrate the full engineering feature development lifecycle from requirements to completion.

## When to Use

- Starting a new engineering feature (any complexity above trivial bugfix)
- Resuming work on an existing feature workspace
- Any task that will produce multiple artifacts (research, design, implementation plan, code)
- When the human provides requirements and wants structured development

## When NOT to Use

- Trivial bugfixes (< 1 hour, single file, no unknowns) — just do the work
- Documentation-only tasks — use `ops-init-workspace` directly
- Tasks that are purely research with no implementation — use `eng-research` directly
- Tasks owned by non-engineering teams (growth landing pages, customer analysis)

## Inputs

- **Requirements text**: Free-form description from the human engineer
- **File references** (optional): Paths to existing code, specs, or docs
- **Web references** (optional): URLs to documentation, libraries, or APIs
- **Workspace ID** (optional): If resuming an existing workspace (e.g., `eng-mcp-creative`)

## Outputs

All artifacts are saved into `docs/temp/engineering/{source-id}/`:

- `README.md` — Workspace metadata and activity log
- `research.md` — Research findings (if research was conducted)
- `design.md` — Technical design (if design was conducted)
- `implementation-plan.md` — Phased implementation plan
- `review-{type}.md` — Review of research, design, or implementation-plan
- `phase-{N}-review.md` — Code review for implementation cycle N
- Code changes in the working tree

## Workflow

**Shared orchestration policy**

- Prefer completeness before speed at each artifact gate: do not advance if important scope, contract, file, or validation coverage is still missing.
- Rigor and detail should scale to the task and requested bar (for example MVP vs production-ready), but use the same lifecycle rather than inventing a separate formal mode system.
- Some critical checks intentionally appear in both producer and review skills when that prevents ambiguity. Keep the overlap to high-value guardrails, not duplicated long rubrics.

### Step 1: Workspace Resolution

1. If a `workspace-id` is provided, check if `docs/temp/engineering/{workspace-id}/` exists.
   - If yes: Read the `README.md` to understand current state. Resume from where work left off (see Resumption Logic below).
   - If no: Error — workspace not found.
2. If no `workspace-id` is provided, derive one from the requirements (e.g., `eng-<short-description>`).
   - Check if a matching workspace already exists via `ops-logbook-status --team engineering`.
   - If a matching workspace exists, confirm with human: reuse or create new?
   - If creating new: invoke `ops-init-workspace --team engineering --source-id {id} --title "{title}"`.
3. Record the workspace path for all subsequent steps.

### Step 2: Complexity Assessment

Consider these factors when evaluating the requirements:

- **File count**: How many files will be created/modified?
- **Layer count**: How many of the 4 layers are affected? (Core → Adapters → Services → Server Actions)
- **Pattern novelty**: Is this a new pattern or following an existing one?
- **Schema impact**: Does it introduce or change Zod schemas / DB schemas?
- **Risk level**: Could a mistake break existing functionality?
- **Unknowns**: Are there technical questions without clear answers?

If unknowns dominate — the technology is new, multiple viable approaches exist, or feasibility is uncertain — classify as **Spike** regardless of other factors.

Otherwise, match the requirements to the closest complexity level:

| Complexity  | Characteristics                               | Research?     | Design?                     | Cycles               |
| ----------- | --------------------------------------------- | ------------- | --------------------------- | -------------------- |
| **Trivial** | < 2h, 1-3 files, well-understood pattern      | No            | No                          | 1                    |
| **Small**   | 2-4h, few files, known pattern                | No            | Light (inline in impl plan) | 1-2                  |
| **Medium**  | 4-8h, multiple files, some unknowns           | Optional      | Yes                         | 2-3                  |
| **Large**   | 1-2 days, cross-cutting, new patterns         | Yes           | Yes                         | 3-5                  |
| **Spike**   | Unknowns dominate, time-boxed research needed | Yes (primary) | Maybe (after research)      | 1-2 (after research) |

Present the assessment to the human and confirm before proceeding.

### Step 3: Research (if applicable — Large or Spike)

1. Invoke `eng-research` with the requirements, file refs, and web refs.
2. The research document is saved to the workspace as `research.md`.
3. If a formal research review is needed, invoke `eng-research-review` on the research document.
    - Large and Spike research outputs require formal review before acceptance.
    - Small/Medium work may still use formal review when risk or ambiguity warrants it.
    - Treat research as ready only when the artifact is complete enough for downstream design, not merely when notes exist.
4. After approval, update `research.md` frontmatter status to `accepted`.
5. If review requests changes: iterate on the research. Update `research.md`.
6. **Human checkpoint**: present research findings, get approval to proceed.
7. **Spike transition**: If this is a Spike, ask the human: (a) research is complete, no implementation needed — skip to Step 7, or (b) proceed to design and implementation. If (b), re-assess complexity as Medium or Large for the implementation portion and continue to Step 4.

### Step 4: Design (if applicable — Medium, Large, or Spike proceeding to implementation)

1. Invoke `eng-design` with the requirements and research document (if exists).
2. The design document is saved to the workspace as `design.md`.
3. If design work reveals unknowns: **loop back to Step 3** (`eng-research`). Do NOT produce ad-hoc analysis artifacts — research and design have strict boundaries.
4. If a formal design review is needed, invoke `eng-design-review` on the design document.
    - Large work requires formal design review.
    - Medium work should generally use formal design review when a standalone design exists.
    - Treat design as ready only when architecture, contracts, file coverage, validation, and testing are complete enough to plan safely.
5. After approval, update `design.md` frontmatter status to `accepted`.
6. If review requests changes: iterate on the design. Update `design.md`.
7. **Human checkpoint**: present design, get approval to proceed.

### Step 5: Implementation Plan (always)

1. Invoke `eng-impl-plan` with the design document (or requirements if no design).
2. The implementation plan is saved to the workspace as `implementation-plan.md`.
3. If a formal implementation-plan review is needed, invoke `eng-impl-plan-review`.
    - Medium and Large work require formal implementation-plan review before execution.
    - Small work may still use formal review when risk or coordination warrants it.
    - Treat the plan as ready only when intended scope is fully covered and execution order/review points are explicit enough to run safely.
4. After approval, update `implementation-plan.md` frontmatter status to `accepted`.
5. **Human checkpoint**: present the plan with cycle breakdown and effort estimates. Confirm.

### Step 6: Execute Cycles

For each cycle `N` in the implementation plan:

1. Invoke `ops-execute-cycle` with:
    - **Cycle ID** from the implementation plan
    - **Workspace path**
    - **Implementation plan path**: `{workspace}/implementation-plan.md`
    - **Review mode**: Read the `Review` field from the cycle definition in the plan. If not specified, use: `self` for Trivial/Small complexity, `formal` for the riskiest cycle of Medium, `formal` for all cycles of Large.
2. The cycle always runs in this order: implement → review → revise.
    - `revise` replaces the older "apply fixes" wording and means: modify code or documentation as needed from review action items.
    - Keep implement, review, and revise as explicit distinct stages. Do not collapse review and revise into one opaque pass.
    - When the cycle review mode is `formal`, review must be a separate explicit reviewer step and any revise work must happen afterward as a separate implementation step if findings exist.
    - When the cycle review mode is `formal`, `ops-execute-cycle` uses `eng-code-review` and writes `phase-{N}-review.md`.
    - A cycle is done only when its scoped work is complete and aligned with architecture, patterns, structure, and standards — not just when checks happen to pass.
3. Update `implementation-plan.md` with cycle completion status.
4. Update workspace `README.md` activity log.
5. **Commit policy**: Do NOT commit unless the human explicitly requests it. No nudging. If the human specifies per-cycle commits, commit after each cycle.

### Step 7: Completion

1. All cycles complete. Update workspace `README.md` status.
2. Present final summary to human:
   - What was implemented
   - Files created/modified
   - Tests passing
   - Any remaining TODOs or follow-ups
3. Wait for human to review, request changes, or approve.
4. If human requests commit: stage and commit all changes.
5. If human requests promotion: invoke `ops-promote-docs` on the workspace.

## Artifact Status Lifecycle

Each artifact's frontmatter `status` field tracks its progress:

```
draft → complete → accepted
```

- **`draft`**: Artifact is being created (set by the template).
- **`complete`**: The producing skill has finished writing it (set by the leaf skill on save — `eng-research`, `eng-design`, `eng-impl-plan`).
- **`accepted`**: Review has approved it (set by the orchestrator after the matching leaf review skill approves).

The orchestrator checks the `status` field in each artifact's YAML frontmatter to determine where to resume.

## Resumption Logic

If invoked on an existing workspace, read the README.md and artifact frontmatter to determine current state:

| If workspace has...                               | Resume from...                                     |
| ------------------------------------------------- | -------------------------------------------------- |
| Only `README.md`                                  | Step 2 (Complexity Assessment)                     |
| `research.md` with `status: draft`                | Step 3 (Research — continue writing)               |
| `research.md` with `status: complete`             | Step 3 (Research — run review)                     |
| `research.md` with `status: accepted`             | Step 4 (Design)                                    |
| `design.md` with `status: draft`                  | Step 4 (Design — continue writing)                 |
| `design.md` with `status: complete`               | Step 4 (Design — run review)                       |
| `design.md` with `status: accepted`               | Step 5 (Implementation Plan)                       |
| `implementation-plan.md` with `status: draft`     | Step 5 (Implementation Plan — continue writing)    |
| `implementation-plan.md` with `status: complete`  | Step 5 (Implementation Plan — run review)          |
| `implementation-plan.md` with `status: accepted`  | Step 6 (Execute Cycles — check which are complete) |
| All cycles marked complete in implementation plan | Step 7 (Completion — present for final review)     |

## Skills Referenced

- `ops-init-workspace` — Workspace creation
- `ops-logbook-status` — Check existing workspaces
- `ops-promote-docs` — Post-completion promotion
- `ops-execute-cycle` — Per-cycle execution
- `eng-research` — Research phase
- `eng-design` — Design phase
- `eng-research-review` — Research review
- `eng-design-review` — Design review
- `eng-impl-plan-review` — Implementation-plan review
- `eng-code-review` — Implementation-cycle code review
- `eng-impl-plan` — Implementation planning
