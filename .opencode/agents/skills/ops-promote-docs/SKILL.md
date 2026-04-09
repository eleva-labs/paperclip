---
name: ops-promote-docs
description: >
  Analyze a completed task workspace and promote it as a unit to official docs.
  Reads all files in the workspace, determines which to include/exclude,
  checks for constitution updates, and copies the workspace to
  docs/<team>/archive/<source-id>/. Produces a checklist for human
  approval, then executes.
---

# Promote Docs

Analyze a completed workspace and promote it to official documentation.

## When to Use

- A task workspace has completed implementation
- Code has been reviewed/merged (or is ready to merge)
- The workspace contains knowledge worth preserving (specs, decisions, research)

## When NOT to Use

- The workspace is still active
- The workspace only contains ephemeral notes with no lasting value
- You're making a quick fix that needs no documentation

## Input

**Workspace path**: `docs/temp/<team>/<source-id>/`

## Workflow

### Step 1: Verify Readiness

Read the workspace `README.md` and check:

- Status is `active` (not `paused`)
- Activity log shows work has been completed
- The human has confirmed the workspace is ready

If incomplete, warn the user and ask whether to proceed.

### Step 2: Inventory All Files

Read every file in the workspace. For each file, classify:

| Classification | Include in Promotion? | Examples                                                 |
| -------------- | --------------------- | -------------------------------------------------------- |
| `metadata`     | YES (README.md only)  | `README.md` — workspace metadata, activity log           |
| `spec`         | YES                   | `spec.md`                                                |
| `decision`     | YES                   | `adr-*.md`, `decision-*.md`                              |
| `research`     | YES                   | `research.md`, `research/*.md`                           |
| `report`       | CASE BY CASE          | `REPORT.md`, `*_SUMMARY.md` — promote if unique analysis |
| `notes`        | NO                    | `notes.md`, `NOTES.md` — ephemeral scratch               |
| `changelog`    | NO                    | `CHANGES.md`, `CHANGELOG.md` — captured in git           |
| `index`        | NO                    | `INDEX.md` — workspace navigation only                   |

### Step 3: Analyze for Constitution Updates

Read all workspace files and look for **lasting rules** that should be embedded in the team's constitution:

1. **New conventions** → May need `docs/<team>/constitution/README.md` update
2. **New architectural decisions** → May need `docs/engineering/architecture/` update
3. **New workflows/processes** → May need constitution update or new skill
4. **New domain rules** → May need constitution or `CLAUDE.md` update
5. **File ownership changes** → May need `CLAUDE.md` update

For each signal found, read the current official doc to check if it already covers the topic.

### Step 4: Determine Promotion Target

**Target directory**: `docs/<team>/archive/<source-id>/`

The team and source-id come from the workspace path:

- `docs/temp/engineering/eng-spike-auth/` → `docs/engineering/archive/eng-spike-auth/`
- `docs/temp/growth/grow-camp-002/` → `docs/growth/archive/grow-camp-002/`

### Step 5: Build Promotion Plan

```
## Promotion Plan for `docs/temp/<team>/<source-id>/`

**Task**: <title from workspace README>
**Team**: <team>
**Owner**: <owner from workspace README>
**Target**: `docs/<team>/archive/<source-id>/`

### Files to Promote

- [ ] `README.md` — workspace metadata and activity log
- [ ] `spec.md` — feature specification
- [ ] `research.md` — background research
      (Update status: draft → accepted)

### Files to Exclude (ephemeral)

- `notes.md` — scratch notes, no lasting value
- `CHANGES.md` — implementation log, captured in git history

### Constitution Updates

- [ ] `docs/<team>/constitution/README.md` — Add rule: "<new rule>"
      Reason: Workspace decision in <file> establishes this as a lasting practice

### Other Official Doc Updates

- [ ] `CLAUDE.md` — Section "<section>": <what to add/change>
      Reason: <why>

### Post-Promotion

- [ ] Update workspace README.md status: active → archived
- [ ] `git add docs/<team>/archive/<source-id>/`
- [ ] `git add` any updated constitution/official docs
```

### Step 6: Get Human Approval

Present the checklist and wait for confirmation. Do not proceed without explicit approval.

### Step 7: Execute the Plan

**Promoting the workspace:**

1. Create target directory: `mkdir -p docs/<team>/archive/<source-id>/`
2. For each file marked for promotion:
   a. Read the source file from `docs/temp/<team>/<source-id>/<file>`
   b. Write to `docs/<team>/archive/<source-id>/<file>`
   c. Update status in frontmatter if applicable (draft → accepted)
3. Log: "Promoted workspace: docs/temp/... → docs/<team>/archive/..."

**Updating constitution or official docs:**

1. Read the current doc
2. Apply the specific edit
3. Log: "Updated: <file> — <description>"

**Post-promotion cleanup:**

1. Edit workspace README.md: set `status: archived`
2. Add activity log entry: `| <date> | <agent> | Workspace promoted to docs/<team>/archive/<source-id>/ |`
3. Output `git add` commands for all promoted and updated files

### Step 8: Summary

```
## Promotion Complete

- Promoted: N files to docs/<team>/archive/<source-id>/
- Excluded: N ephemeral files
- Updated: N official docs (constitution, CLAUDE.md, etc.)

### Files to commit:
git add docs/<team>/archive/<source-id>/
git add <updated-official-docs>

### Workspace archived:
docs/temp/<team>/<source-id>/README.md status → archived
```
