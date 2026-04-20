---
name: ops-init-workspace
description: >
  Initialize a task workspace for a team. Creates a docs/temp/<team>/<source-id>/
  directory with a README.md containing metadata (title, status, owner, team) and an activity log.
  Use this when starting any non-trivial task that needs a workspace for specs, research, or artifacts.
---

# Init Workspace

Creates a new task workspace directory under `docs/temp/<team>/<source-id>/` with a templated `README.md`.

## Usage

```bash
bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh --team <team> --source-id <id> --title "Title"
```

## Arguments

| Argument      | Required | Description                                               |
| ------------- | -------- | --------------------------------------------------------- |
| `--team`      | Yes      | Team name: `product`, `engineering`, `growth`, `customer` |
| `--source-id` | Yes      | Unique ID with team prefix (e.g., `eng-spike-auth`)       |
| `--title`     | Yes      | Human-readable workspace title                            |

### Source ID Prefixes

| Team        | Prefix  | Example                  |
| ----------- | ------- | ------------------------ |
| Product     | `prod-` | `prod-feature-budgets`   |
| Engineering | `eng-`  | `eng-spike-auth`         |
| Growth      | `grow-` | `grow-camp-002`          |
| Customer    | `cust-` | `cust-feedback-analysis` |

## Examples

```bash
# Engineering workspace
bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh \
  --team engineering --source-id eng-spike-auth --title "Auth spike"

# Growth workspace
bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh \
  --team growth --source-id grow-camp-002 --title "CAMP-002 setup"

# Product workspace
bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh \
  --team product --source-id prod-feature-budgets --title "Budget notifications feature"
```

## When to Use

- Starting any multi-day or cross-team feature
- Beginning a spike or research task
- Any task that will produce specs, ADRs, or research artifacts
- NOT needed for trivial bugfixes (< 1 hour)

## What It Creates

```
docs/temp/<team>/<source-id>/
  README.md    # Metadata + activity log template
```

## Environment Variables

- `AGENT_ROLE` -- If set, used as the workspace owner in the README. Defaults to `systems-architect`.
