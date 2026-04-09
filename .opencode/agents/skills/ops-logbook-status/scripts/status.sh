#!/usr/bin/env bash

# ops-logbook-status skill
# Usage: bash .opencode/skills/ops-logbook-status/scripts/status.sh [--team <team>] [--stale]

# Parse arguments
TEAM=""
STALE_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --team)
      TEAM="$2"
      shift 2
      ;;
    --stale)
      STALE_ONLY=true
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

echo "Workspace Status Report"
echo ""

# Function to calculate days since last modified
days_since_modified() {
  local path=$1
  local now
  local modified
  now=$(date +%s)
  
  # macOS vs Linux stat command
  if [[ "$OSTYPE" == "darwin"* ]]; then
    modified=$(stat -f %m "$path" 2>/dev/null)
  else
    modified=$(stat -c %Y "$path" 2>/dev/null)
  fi
  
  echo $(( (now - modified) / 86400 ))
}

# Function to check if workspace is stale
is_stale() {
  local days=$1
  # Simple threshold: 7 days for now (can be refined later)
  [[ $days -gt 7 ]]
}

# Find all active workspaces
TEAMS=("product" "engineering" "growth" "customer")
if [[ -n "$TEAM" ]]; then
  TEAMS=("$TEAM")
fi

ACTIVE_COUNT=0
STALE_COUNT=0

if [[ "$STALE_ONLY" == false ]]; then
  echo "Active Workspaces:"
fi

for team in "${TEAMS[@]}"; do
  TEAM_PATH="docs/temp/$team"
  if [[ ! -d "$TEAM_PATH" ]]; then
    continue
  fi
  
  for workspace in "$TEAM_PATH"/*; do
    if [[ ! -d "$workspace" ]]; then
      continue
    fi
    
    # Skip archive subdirectory
    TASK_NAME=$(basename "$workspace")
    if [[ "$TASK_NAME" == "archive" ]]; then
      continue
    fi
    
    DAYS=$(days_since_modified "$workspace")
    
    # Extract title from README.md
    TITLE=""
    if [[ -f "$workspace/README.md" ]]; then
      TITLE=$(grep '^title:' "$workspace/README.md" 2>/dev/null | sed 's/^title: "\(.*\)"$/\1/' | sed "s/^title: '\(.*\)'$/\1/" | sed 's/^title: \(.*\)$/\1/')
    fi
    if [[ -z "$TITLE" ]]; then
      TITLE="(no title)"
    fi
    
    # Check if stale
    STALE_MARKER=""
    if is_stale "$DAYS"; then
      STALE_MARKER="STALE"
      ((STALE_COUNT++))
    fi
    
    ((ACTIVE_COUNT++))
    
    if [[ "$STALE_ONLY" == false ]] || [[ -n "$STALE_MARKER" ]]; then
      echo "  $team/$TASK_NAME ($DAYS days old) -- $TITLE $STALE_MARKER"
    fi
  done
done

if [[ "$STALE_ONLY" == false ]]; then
  echo ""
  echo "Summary:"
  echo "  Active workspaces: $ACTIVE_COUNT"
  echo "  Stale workspaces: $STALE_COUNT"
fi

if [[ "$STALE_ONLY" == true ]] && [[ $STALE_COUNT -eq 0 ]]; then
  echo "No stale workspaces found"
fi
