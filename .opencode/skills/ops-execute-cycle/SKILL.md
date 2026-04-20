---
name: ops-execute-cycle
description: >
  Execute a single implement → review → revise cycle. The atomic unit of tracked work.
  Takes a cycle definition from an implementation plan, implements it, gets it reviewed,
  and revises in response to review findings. Generic cross-team skill usable by any team, not just engineering.
  This is a placeholder — detailed process will be refined through usage.
---

# Execute Cycle

Execute a single implement → review → revise cycle from an implementation plan.

## When to Use

- Executing a cycle defined in an implementation plan (created by `eng-impl-plan`)
- Any tracked unit of work that follows the implement → review → revise pattern
- Called by `eng-feature-dev` orchestrator during Step 6 (Execute Cycles)

## When NOT to Use

- No implementation plan exists yet — create one first with `eng-impl-plan`
- The cycle's dependencies are not yet complete
- Pure research or design tasks — use `eng-research` or `eng-design` instead

## Inputs

- **Cycle definition**: From the implementation plan — cycle ID, files, acceptance criteria, review mode
- **Workspace path**: For saving review artifacts and updating status
- **Implementation plan path**: To update cycle status after completion

## Outputs

- Code changes in the working tree (files created/modified per the cycle definition)
- `{workspace}/phase-{N}-review.md` — Review document for every formal implementation-cycle review
- Updated `{workspace}/implementation-plan.md` — Cycle marked complete

## Workflow

### Step 1: Load Cycle Definition

1. Read the implementation plan at `{workspace}/implementation-plan.md`.
2. Find the current cycle by cycle ID (e.g., `1.1`, `2.3`).
3. Verify dependencies are met — all prior cycles listed in "Dependencies" must be marked complete.
4. Load the acceptance criteria checklist for this cycle.
5. Read the `Review` field for this cycle: `self` or `formal`.
6. If dependencies are NOT met, report back to the orchestrator with which cycles are blocking.

### Step 2: Implement

1. Read the design doc section referenced by this cycle.
2. Read any existing code patterns or files that serve as reference.
3. For each file to **create**:
   - Follow project conventions (engineering constitution, existing patterns)
   - Write the file with proper TypeScript types, Zod validation, etc.
4. For each file to **modify**:
    - Read the current file
    - Apply the changes specified by the design
    - Preserve existing functionality (backwards-compatible)
5. Before moving to review, check the cycle against its scoped completeness: intended files, acceptance criteria, architecture fit, repo patterns, file/folder placement, and relevant standards/conventions.
6. Run type checking: `tsc --noEmit` (or equivalent for the package).
7. Run tests if applicable: `vitest run` (or equivalent).
8. If type checking or tests fail, fix the issues before proceeding.

### Step 3: Review

Check the `Review` field from the cycle definition:

**Cycle invariant**: cycles must ALWAYS run as separate implement / review / revise stages. Do not collapse review and revise into one opaque pass. `revise` replaces the older "apply fixes" wording and means: modify code or documentation as needed from review action items.

**If `self`**: The implementer performs an explicit self-review of the changes against the acceptance criteria plus cycle-scope completeness, architecture fit, repo patterns, file/folder placement, and relevant standards. Verify type checking passes and tests pass. If everything looks correct, skip to Step 5. If issues are found, proceed to Step 4 to revise, then re-review. No written review artifact is produced.

**If `formal`**: Invoke `eng-code-review` and always write `{workspace}/phase-{N}-review.md` for the reviewed cycle:

1. Artifact type: `code`
2. Artifact paths: all files created/modified in this cycle
3. Context: the cycle's acceptance criteria + design doc reference
4. Process the review verdict:
    - **APPROVE** ✅: Skip to Step 5 (no revise step needed).
    - **APPROVE WITH CONDITIONS** ⚠️: Proceed to Step 4 (revise should-fix items).
    - **REQUEST CHANGES** ❌: Proceed to Step 4 (revise all required fixes).

For `formal` review, the review must be a separate explicit reviewer step, and if findings exist the revise work must be a separate explicit implementation step. Formal review and revise must not be operationally merged.

Use `eng-code-review` only for formal implementation-cycle code review. Other artifact reviews happen through their own leaf review skills outside this execution workflow.

### Step 4: Revise (if review found issues)

1. For each **Blocker**: revise the implementation to address it (mandatory).
2. For each **Should Fix**: revise the implementation to address it (mandatory for APPROVE WITH CONDITIONS).
3. For each **Suggestion**: revise at implementer's discretion (not required).
4. Re-run type checking and tests.
5. If blockers remain after fixes, loop back to Step 3 (max **2 re-review rounds** to prevent infinite loops).
6. If still blocked after 2 rounds, escalate to human.

### Step 5: Complete

1. Verify all acceptance criteria from the implementation plan are met (check each item).
2. Verify the delivered changes fully satisfy the cycle scope, including intended files, architecture/pattern fit, file placement, and relevant standards/conventions.
3. Update the implementation plan: mark this cycle as **complete** with the date.
4. Update the workspace `README.md` activity log with: date, agent, "Cycle {ID} complete: {summary}".
5. Return summary to the invoking skill/agent:
   - Files created/modified (list)
   - Tests passing (count)
   - Review verdict
   - Any notes or follow-ups

## Cycle States

```
implementing → reviewing → revising → complete
                  │                      ▲
                  └──── (if APPROVE) ────┘
```

## Commit Policy

This skill does NOT commit. Commits are controlled by the human via `eng-feature-dev`:

- Do NOT run `git add` or `git commit`
- Do NOT suggest or nudge the human to commit
- Simply report what files were changed — the human decides when to commit

## Skills Referenced

- `eng-code-review` — Formal implementation-cycle code review

## Acceptance Criteria

- All files specified in the cycle definition are created/modified
- Cycle scope is completely satisfied, not just partially implemented
- Type checking passes (`tsc --noEmit` or equivalent)
- Tests pass (if tests are part of this cycle)
- Review verdict is APPROVE or APPROVE WITH CONDITIONS (with conditions addressed)
- Changes fit repo architecture, patterns, file/folder structure, and relevant standards/conventions
- Implementation plan is updated with cycle completion status and date
- Workspace README.md activity log is updated
