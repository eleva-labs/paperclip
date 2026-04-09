---
name: eng-impl-plan
description: >
  Break a design (or requirements) into phased, trackable implementation cycles. Each cycle
  has an implementing agent, effort estimate, dependencies, files to create/modify, and
  acceptance criteria. The plan is the execution roadmap for ops-execute-cycle. Use this
  after design is complete (or directly after requirements for simple features).
---

# Implementation Plan

Break a design into phased, trackable implementation cycles that serve as the execution roadmap.

## When to Use

- After `eng-design` produces a design document
- After requirements are clear (for Small/Trivial features that skip formal design)
- Always required before `ops-execute-cycle` — every feature needs a plan, even if it's a single cycle

## When NOT to Use

- Before research or design is complete (the plan needs a design to decompose)
- For documentation-only tasks

## Inputs

- **Design document**: `{workspace}/design.md` (primary input for Medium+ features)
- **Requirements text**: Original requirements (for context, or primary input for Small/Trivial)
- **Research document** (optional): `{workspace}/research.md` (for additional context)
- **Workspace path**: Where to save the implementation plan

## Outputs

- `{workspace}/implementation-plan.md` — Phased plan using the implementation plan template

## Workflow

### Step 1: Analyze the Design

1. Read the design document fully (or requirements if no design exists).
2. Identify ALL files to create and modify from the file manifest in the design.
3. Check for any intended scope not fully represented in the file manifest, contracts, validation, testing, rollout, or migration notes. Resolve those gaps before optimizing execution.
4. Identify dependency relationships between files:
   - Schema files → before services that import them
   - DB adapters → before services that use them
   - Services → before Server Actions that call them
   - Tests → alongside or after their implementation
5. Identify which agent should implement each piece based on file ownership (from CLAUDE.md):
   - `packages/core/schemas/`, `packages/core/constants/` → systems-architect
   - `packages/core/rules/`, `packages/core/parsers/` → backend-engineer
   - `apps/web/lib/services/`, `apps/web/lib/db/` → backend-engineer
   - `apps/web/app/(dashboard)/`, `apps/web/app/(auth)/` → frontend-engineer
   - `apps/web/components/ui/` → systems-architect

### Step 2: Determine Cycle Count

Start from the file count:

| Total Files | Starting Cycles |
| ----------- | --------------- |
| 1-3         | 1 cycle         |
| 4-8         | 2 cycles        |
| 9-15        | 3 cycles        |
| 16-25       | 4 cycles        |
| 25+         | 5 cycles        |

Then adjust:

- **+1 cycle** if multiple agents are needed (separate agent work into separate cycles)
- **+1 cycle** if schema/migration work exists (isolate as Phase 1 for early review)
- **-1 cycle** if all files follow the same pattern (batch similar work)
- **-1 cycle** if no tests are needed (faster cycles)

Final cycle count is always between **1 and 5**.

### Step 3: Group Into Phases and Cycles

1. Group related files into cycles. Each cycle should be:
    - Completable in **1-4 hours**
    - Self-contained enough to review independently
    - Have clear acceptance criteria that can be verified
2. Make serial vs parallel structure explicit. Name which cycles must be sequential and which can run in parallel once dependencies are satisfied.
3. Group cycles into phases by dependency order:
   - Phase 1: Foundation (schemas, types, config)
   - Phase 2: Infrastructure (adapters, utilities)
   - Phase 3: Business logic (services, rules)
   - Phase 4: UI layer (Server Actions, components)
   - Phase 5: Integration (wiring, registration, testing)
4. Within each phase, identify which cycles can run in parallel.
5. Choose review points intentionally: use formal review at riskier boundaries or handoff points, and use self-review only where the cycle is narrow enough that formal review would add little value.

### Step 4: Write the Plan

For each cycle, specify ALL of:

| Field                   | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| **Cycle ID**            | `{Phase}.{Cycle}` (e.g., `1.1`, `2.3`)                              |
| **Name**                | Short descriptive name                                              |
| **Implementing agent**  | Which agent role does the work                                      |
| **Effort estimate**     | Time in minutes or hours                                            |
| **Dependencies**        | Which prior cycles must be complete, or "None"                      |
| **Execution mode**      | `serial` or `parallel` relative to sibling cycles in the same phase  |
| **Review**              | `self` (implementer self-reviews) or `formal` (invoke `eng-code-review`) |
| **Files to create**     | New files with full paths (directory tree format)                   |
| **Files to modify**     | Existing files with full paths                                      |
| **Acceptance criteria** | Checklist of verifiable conditions (use `- [ ]` format)             |
| **Reference**           | Pointer to design doc section(s)                                    |

### Step 5: Add Execution Metadata

For plans with **3+ cycles**, add all of these sections. For plans with **1-2 cycles**, only add items 1, 5, and 6 — skip the rest.

1. **Phase overview table** — Summary of all phases with cycle counts, agents, effort, gates, and parallelism notes.
2. **Execution order diagram** — ASCII diagram showing serial and parallel dependency flow between phases and cycles.
3. **Complete file manifest** — All files across all cycles in a single table (files to create + files to modify).
4. **Effort summary by agent** — Which agent does what and total time.
5. **Review checkpoints** — What reviews happen, why they happen there, and where self-review is acceptable.
6. **Empty activity log** — Table for tracking progress during execution.

### Step 6: Save

1. Write the plan to `{workspace}/implementation-plan.md` using the template at `docs/engineering/templates/implementation-plan.md`.
2. Update the document's frontmatter `status` from `draft` to `complete`.
3. Update the workspace `README.md` activity log with: date, agent, "Created implementation plan: {N} phases, {M} cycles, {effort}".
4. Present a summary to the invoking skill/agent:
    - Total phases and cycles
    - Total estimated effort
    - Agent breakdown
    - Key dependencies, parallelism, or risks

Formal review of the completed plan, when required, is handled outside this producer skill via `eng-impl-plan-review`. Medium and Large work should not proceed to execution until that review is complete.

## Template

Uses: `docs/engineering/templates/implementation-plan.md`

## Acceptance Criteria

- Implementation plan exists in the workspace with all template sections filled
- Every file from the design's file manifest appears in exactly one cycle
- Intended scope is fully covered before execution efficiency optimizations are applied
- Every cycle has acceptance criteria written as a verifiable checklist
- Every cycle has an `Execution mode` field set to `serial` or `parallel`
- Every cycle has a `Review` field set to `self` or `formal`
- Dependencies between cycles are explicitly stated (no implicit assumptions)
- Review opportunities are placed intentionally and described clearly
- Effort estimates are provided for every cycle
- Cycle count is between 1 and 5
- Each cycle is completable in 1-4 hours
