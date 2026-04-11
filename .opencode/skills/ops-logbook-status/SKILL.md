---
name: ops-logbook-status
description: >
  Show the status of all task workspaces across teams. Lists active workspaces with
  their age, title, and staleness indicator (>7 days). Can filter by team or show only stale
  workspaces. Use this to get an overview of in-progress work across the organization.
---

# Workspace Status

Displays a status report of all active task workspaces under `docs/temp/`.

## Usage

```bash
bash .opencode/skills/ops-logbook-status/scripts/status.sh [--team <team>] [--stale]
```

## Arguments

| Argument  | Required | Description                                                    |
| --------- | -------- | -------------------------------------------------------------- |
| `--team`  | No       | Filter by team: `product`, `engineering`, `growth`, `customer` |
| `--stale` | No       | Show only stale workspaces (>7 days since last modification)   |

## Examples

```bash
# Show all workspaces
bash .opencode/skills/ops-logbook-status/scripts/status.sh

# Show only engineering workspaces
bash .opencode/skills/ops-logbook-status/scripts/status.sh --team engineering

# Show only stale workspaces
bash .opencode/skills/ops-logbook-status/scripts/status.sh --stale

# Show stale workspaces for a specific team
bash .opencode/skills/ops-logbook-status/scripts/status.sh --team growth --stale
```

## When to Use

- Before starting new work, to see what's in progress
- During standups or planning, to review active workspaces
- To find stale workspaces that need attention or archiving
- To get an overview of team workload

## Output

The report shows:

- Each workspace with its team, source-id, age in days, and title
- A staleness warning for workspaces older than 7 days
- Summary counts of active and stale workspaces
