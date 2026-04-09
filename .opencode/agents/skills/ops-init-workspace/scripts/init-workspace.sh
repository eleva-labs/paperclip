#!/usr/bin/env bash
set -e

# ops-init-workspace skill
# Usage: bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh --team <team> --source-id <id> --title "Title"

# Parse arguments
TEAM=""
SOURCE_ID=""
TITLE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --team)
      TEAM="$2"
      shift 2
      ;;
    --source-id)
      SOURCE_ID="$2"
      shift 2
      ;;
    --title)
      TITLE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Validate required arguments
if [[ -z "$TEAM" ]] || [[ -z "$SOURCE_ID" ]] || [[ -z "$TITLE" ]]; then
  echo "Error: Missing required arguments"
  echo "Usage: bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh --team <team> --source-id <id> --title \"Title\""
  echo ""
  echo "Examples:"
  echo "  bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh --team growth --source-id grow-001 --title \"CAMP-001 setup\""
  echo "  bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh --team engineering --source-id eng-spike-auth --title \"Auth spike\""
  echo "  bash .opencode/skills/ops-init-workspace/scripts/init-workspace.sh --team product --source-id prod-feature-auth --title \"Auth feature\""
  exit 1
fi

# Validate team
VALID_TEAMS=("product" "engineering" "growth" "customer")
VALID_TEAMS_STR="${VALID_TEAMS[*]}"
if [[ ! " ${VALID_TEAMS_STR} " =~ " ${TEAM} " ]]; then
  echo "Error: Invalid team '$TEAM'"
  echo "Valid teams: ${VALID_TEAMS_STR}"
  exit 1
fi

# Validate source-id prefix
case $TEAM in
  product)
    REQUIRED_PREFIX="prod-"
    ;;
  engineering)
    REQUIRED_PREFIX="eng-"
    ;;
  growth)
    REQUIRED_PREFIX="grow-"
    ;;
  customer)
    REQUIRED_PREFIX="cust-"
    ;;
esac

if [[ ! "$SOURCE_ID" =~ ^${REQUIRED_PREFIX} ]]; then
  echo "Error: Source ID must start with '${REQUIRED_PREFIX}' for team '$TEAM'"
  echo "Given: '$SOURCE_ID'"
  echo ""
  echo "Examples for $TEAM:"
  echo "  ${REQUIRED_PREFIX}001"
  echo "  ${REQUIRED_PREFIX}feature-name"
  echo "  ${REQUIRED_PREFIX}spike-description"
  exit 1
fi

# Construct workspace path
WORKSPACE_PATH="docs/temp/$TEAM/$SOURCE_ID"

# Check if workspace already exists
if [[ -d "$WORKSPACE_PATH" ]]; then
  echo "Error: Workspace already exists: $WORKSPACE_PATH"
  echo "Tip: To resume, cd into the workspace and update README.md"
  exit 1
fi

# Create workspace directory
mkdir -p "$WORKSPACE_PATH"

# Get current date
DATE=$(date +%Y-%m-%d)

# Get current agent (from environment or default)
AGENT="${AGENT_ROLE:-systems-architect}"

# Create README.md from template
cat > "$WORKSPACE_PATH/README.md" <<EOF
---
title: "$TITLE"
status: active
owner: $AGENT
team: $TEAM
---

# $TITLE — Workspace

## Purpose

[Why this workspace exists and what it aims to produce]

## Status

Active — just created. Starting work.

## Activity Log

| Date | Agent | Action |
|------|-------|--------|
| $DATE | $AGENT | Created workspace |

---

## Notes

[Optional: Add working notes, decisions, blockers, open questions here]
EOF

# Output success message
echo ""
echo "Workspace created: $WORKSPACE_PATH"
echo "README.md initialized with metadata"
echo ""
echo "Next steps:"
echo "   cd $WORKSPACE_PATH"
echo "   # Create spec.md, notes.md, or other documents"
echo ""
