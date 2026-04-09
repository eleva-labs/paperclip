---
name: eng-pr
description: >
  Create a complete GitHub pull request from an already-implemented branch by analyzing the
  full branch scope, classifying repo-specific impacts, drafting a reviewer-friendly title and
  body, and creating the PR with gh. Use this when implementation is done and the branch is
  ready to publish.
---

# PR

Create a complete, reviewer-friendly GitHub pull request from a ready branch.

## When to Use

- Implementation is already complete on the current branch
- The branch needs a GitHub PR with accurate branch-wide summary and reviewer guidance
- The human or an engineering orchestrator explicitly requests PR creation
- The work needs Forgebox-specific impact analysis instead of a generic PR summary

## When NOT to Use

- Before implementation is materially complete
- When the branch still contains unrelated or mixed concerns that should be split first
- For commit creation, design, research, or implementation planning
- To define future branch governance as if it were already active

## Inputs

- **Base branch** (optional): Intended PR target. If omitted, resolve from current repo reality and task context.
- **Workspace path** (optional): Relevant engineering workspace for context or follow-up artifacts
- **Reviewer focus** (optional): Specific areas the human wants reviewers to inspect closely
- **Draft intent** (optional): Whether the PR should be opened as draft when validation or follow-up work is incomplete

## Outputs

- GitHub PR URL
- Final PR title
- Final PR body
- Concise impact/risk summary returned to the caller

## Workflow

For canonical branch naming, target selection, and back-merge governance, follow `docs/constitution/repository-governance/README.md`. This skill should apply that governance rather than restating it.

### Step 1: Confirm Repo State

1. Inspect `git status --short --branch`.
2. Detect the current branch, upstream tracking state, and whether the branch is ahead/behind its remote.
3. Resolve the base branch:
   - Use the explicit human-provided base branch if given.
   - Otherwise resolve it from the repository-governance doc and current repo state.
   - If current automation/repo state and proposed governance differ, call that out explicitly and avoid silently assuming the future model is already active.
4. If the working tree has unexpected unstaged or untracked changes, decide whether they belong in the PR:
    - if yes, include them in branch analysis
    - if no, warn that the branch is not publication-ready
5. If the branch has no meaningful delta from the base branch, stop and report that there is nothing to open as a PR.

### Step 2: Analyze Full Branch Scope

1. Determine the branch divergence point from the chosen base branch.
2. Inspect the full commit range since divergence, not just the latest commit.
3. Inspect the full branch diff with `git diff <base>...HEAD`.
4. Inspect staged and unstaged diffs as a guard against omissions.
5. Read enough changed files and docs to classify the branch accurately. Prioritize changed files that reveal:
   - shared contracts, schemas, constants, or core invariants
   - API routes or request/response contracts
   - service, adapter, runtime, queue, worktree, or scheduling behavior
   - persistence schema or migrations
   - config/env expectations
   - frontend transport, auth, SSE, or UI behavior
   - docs, constitutions, skills, or process guidance
6. If the branch contains unrelated concerns, warn and stop unless the human explicitly wants a combined PR anyway.

### Step 3: Classify Impacts

Summarize the branch in reviewer-relevant terms:

- what problem or context the branch addresses
- what changed across the repo's layers or governance surfaces
- which validations ran and which were skipped
- what risks, caveats, migrations, config changes, or follow-ups remain
- where reviewers should focus attention
- any merge or rollout sequencing notes

Do not write the PR as a commit log. Write it as the branch narrative reviewers need.

### Step 4: Draft Title and Body

1. Draft a concise PR title that reflects the branch-level outcome.
2. Draft a concise but complete PR body using the skill template.
3. Keep the body reviewer-oriented:
   - lead with net outcome and why it matters
   - classify impacts by domain/layer
   - call out validations and omissions honestly
   - highlight risks, caveats, and follow-ups
   - include reviewer focus and merge/rollout notes when relevant
4. If validation is incomplete, migrations are risky, or follow-up work is still required, prefer draft PR mode unless the human says otherwise.

### Step 5: Forgebox PR Completeness Check

Before creating the PR, verify the draft covers all relevant items:

- [ ] Branch scope is based on full divergence-from-base analysis, not the latest commit only
- [ ] Base branch choice matches repository governance, current repo reality, or an explicit human instruction
- [ ] Schema, API, runtime, persistence, config, frontend, and docs impacts are called out when relevant
- [ ] Validation run, validation skipped, and manual checks are stated clearly
- [ ] Risks, caveats, follow-ups, and reviewer focus are explicit
- [ ] Merge, rollout, migration, or env sequencing notes are included when relevant
- [ ] Any difference between current automation reality and proposed branch governance is labeled accurately

### Step 6: Create the PR

1. If the branch has no upstream remote, push with upstream tracking.
2. If the branch is behind its remote or base branch in a way that changes PR meaning, warn before creating the PR.
3. Create the PR with `gh pr create`, using the final title/body and draft mode when appropriate.
4. Return:
   - PR URL
   - final title
   - short summary of impacts
   - any caveats that reviewers should know immediately

## Practical Git / GitHub Workflow

Use git and GitHub inspection in this order:

1. `git status --short --branch`
2. current branch + upstream tracking inspection
3. base-branch resolution
4. commit log since divergence from base
5. `git diff <base>...HEAD`
6. staged + unstaged diff guard check
7. targeted reading of changed files/docs for impact classification
8. draft title/body
9. push with upstream if needed
10. `gh pr create`

## PR Body Template

Use: `template.md`

Keep it lean. Omit sections that are truly not relevant, but do not omit important risk or rollout information just to stay short.

## Acceptance Criteria

- PR analysis covers the full branch scope since divergence from the selected base branch
- The PR title reflects the net branch outcome, not a single internal step
- The PR body is concise but complete enough for reviewer comprehension
- Validation, caveats, reviewer focus, and merge/rollout notes are included when relevant
- Forgebox-specific impact areas are called out when they changed
- Branch-target behavior is applied per canonical repository governance and any current-state exceptions are described accurately
- The PR is created with `gh pr create` and the URL is returned
