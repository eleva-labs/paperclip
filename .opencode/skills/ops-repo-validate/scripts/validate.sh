#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# ops-repo-validate — Repository structure and naming validation
#
# Usage:
#   bash .opencode/skills/ops-repo-validate/scripts/validate.sh --staged  # pre-commit
#   bash .opencode/skills/ops-repo-validate/scripts/validate.sh --all     # manual
# =============================================================================

MODE=""
ERRORS=0

# --- Argument parsing --------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case $1 in
    --staged)
      MODE="staged"
      shift
      ;;
    --all)
      MODE="all"
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: validate.sh --staged | --all"
      exit 1
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Error: Must specify --staged or --all"
  echo "Usage: validate.sh --staged | --all"
  exit 1
fi

# --- Helper functions --------------------------------------------------------

get_files() {
  if [[ "$MODE" == "staged" ]]; then
    git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true
  else
    # All tracked files + untracked files (exclude .git, node_modules, etc.)
    git ls-files 2>/dev/null || true
  fi
}

report_error() {
  local rule="$1"
  local file="$2"
  local message="$3"
  echo "  [$rule] $file"
  echo "         $message"
  ERRORS=$((ERRORS + 1))
}

# --- Get file list -----------------------------------------------------------

FILES=$(get_files)
if [[ -z "$FILES" ]]; then
  echo "No files to check."
  exit 0
fi

echo "Validating repository structure (mode: $MODE)..."
echo ""

# =============================================================================
# RULE 1: No secret files staged
# =============================================================================

# Match actual secret files, not .env.example or .env.local.example
SECRETS_PATTERN='(^|/)\.env$|(^|/)\.env\.local$|(^|/)\.env\.production$|(^|/)\.env\.staging$|credentials\.json|\.pem$|\.key$|(^|/)secrets?\.'
# Exclude .example files
SECRETS_EXCLUDE='\.example$'

SECRET_FILES=$(echo "$FILES" | grep -iE "$SECRETS_PATTERN" | grep -ivE "$SECRETS_EXCLUDE" || true)
if [[ -n "$SECRET_FILES" ]]; then
  echo "RULE: No secret files"
  while IFS= read -r f; do
    report_error "secrets" "$f" "Possible secret file — do not commit"
  done <<< "$SECRET_FILES"
  echo ""
fi

# =============================================================================
# RULE 2: docs/ root — only README.md allowed at docs/ root level
# =============================================================================

# Files directly in docs/ (not in subdirectories), excluding README.md
DOCS_ROOT_FILES=$(echo "$FILES" | grep -E '^docs/[^/]+$' | grep -v '^docs/README\.md$' || true)
if [[ -n "$DOCS_ROOT_FILES" ]]; then
  echo "RULE: No files at docs/ root (except README.md)"
  while IFS= read -r f; do
    report_error "docs-root" "$f" "Files must be in team folders (docs/{product,engineering,growth,customer}/)"
  done <<< "$DOCS_ROOT_FILES"
  echo ""
fi

# =============================================================================
# RULE 3: No stale top-level folders
# =============================================================================

STALE_DIRS="docs/specs/|docs/decisions/|docs/research/"
STALE_FILES=$(echo "$FILES" | grep -E "^($STALE_DIRS)" || true)
if [[ -n "$STALE_FILES" ]]; then
  echo "RULE: No stale top-level folders (docs/specs/, docs/decisions/, docs/research/)"
  while IFS= read -r f; do
    report_error "stale-dir" "$f" "This folder has been removed — use docs/<team>/archive/ instead"
  done <<< "$STALE_FILES"
  echo ""
fi

# =============================================================================
# RULE 4: docs/temp/ files should NOT be committed
# =============================================================================

TEMP_FILES=$(echo "$FILES" | grep -E '^docs/temp/' | grep -v '^docs/temp/README\.md$' || true)
if [[ -n "$TEMP_FILES" ]]; then
  echo "RULE: docs/temp/ files should not be committed (except README.md)"
  while IFS= read -r f; do
    report_error "temp-files" "$f" "Ephemeral workspace file — should be gitignored"
  done <<< "$TEMP_FILES"
  echo ""
fi

# =============================================================================
# RULE 5: Valid team folder names in docs/
# =============================================================================

# Allowed top-level dirs under docs/: product, engineering, growth, customer,
# constitution (root index), templates (root index), temp, old, packages
VALID_DOCS_DIRS="product|engineering|growth|customer|constitution|templates|temp"

INVALID_TEAM_FILES=$(echo "$FILES" | grep -E '^docs/[^/]+/' | \
  grep -vE "^docs/($VALID_DOCS_DIRS)/" || true)
if [[ -n "$INVALID_TEAM_FILES" ]]; then
  echo "RULE: Valid team folders in docs/"
  while IFS= read -r f; do
    report_error "team-folder" "$f" "Must be in: product, engineering, growth, customer (or constitution, templates as indexes)"
  done <<< "$INVALID_TEAM_FILES"
  echo ""
fi

# =============================================================================
# RULE 6: Root index dirs (constitution/, templates/) only contain README.md
# =============================================================================

CONST_INDEX_FILES=$(echo "$FILES" | grep -E '^docs/constitution/[^/]+$' | \
  grep -v '^docs/constitution/README\.md$' || true)
if [[ -n "$CONST_INDEX_FILES" ]]; then
  echo "RULE: docs/constitution/ is an index — only README.md allowed"
  while IFS= read -r f; do
    report_error "index-only" "$f" "Team constitutions belong in docs/<team>/constitution/"
  done <<< "$CONST_INDEX_FILES"
  echo ""
fi

TMPL_INDEX_FILES=$(echo "$FILES" | grep -E '^docs/templates/[^/]+$' | \
  grep -v '^docs/templates/README\.md$' || true)
if [[ -n "$TMPL_INDEX_FILES" ]]; then
  echo "RULE: docs/templates/ is an index — only README.md allowed"
  while IFS= read -r f; do
    report_error "index-only" "$f" "Team templates belong in docs/<team>/templates/"
  done <<< "$TMPL_INDEX_FILES"
  echo ""
fi

# =============================================================================
# RULE 7: Source IDs in workspace paths use correct team prefix
# =============================================================================

# Check docs/<team>/archive/<source-id>/ paths
ARCHIVE_FILES=$(echo "$FILES" | grep -E '^docs/(product|engineering|growth|customer)/archive/[^/]+/' || true)
if [[ -n "$ARCHIVE_FILES" ]]; then
  while IFS= read -r f; do
    # Extract team and source-id
    TEAM=$(echo "$f" | sed -E 's|^docs/([^/]+)/archive/.*|\1|')
    SOURCE_ID=$(echo "$f" | sed -E 's|^docs/[^/]+/archive/([^/]+)/.*|\1|')

    case $TEAM in
      product)     EXPECTED_PREFIX="prod-" ;;
      engineering) EXPECTED_PREFIX="eng-" ;;
      growth)      EXPECTED_PREFIX="grow-" ;;
      customer)    EXPECTED_PREFIX="cust-" ;;
    esac

    if [[ ! "$SOURCE_ID" =~ ^${EXPECTED_PREFIX} ]]; then
      if [[ $ERRORS -eq 0 ]] || ! echo "$REPORTED_IDS" 2>/dev/null | grep -q "$SOURCE_ID"; then
        echo "RULE: Source ID prefix must match team"
        report_error "source-id" "$f" "Source ID '$SOURCE_ID' must start with '$EXPECTED_PREFIX' for team '$TEAM'"
        REPORTED_IDS="${REPORTED_IDS:-}${SOURCE_ID}\n"
        echo ""
      fi
    fi
  done <<< "$ARCHIVE_FILES"
fi

# =============================================================================
# RULE 8: Filename naming standards — lowercase, hyphens, no spaces
# =============================================================================

# Conventional uppercase names that are allowed
UPPERCASE_ALLOWED="README\.md|SKILL\.md|LICENSE|CHANGELOG\.md|CONTRIBUTING\.md|Dockerfile|Makefile|Procfile|Taskfile\.yml|Turborepo"

while IFS= read -r f; do
  # Skip empty lines
  [[ -z "$f" ]] && continue

  # Get just the filename (basename)
  BASENAME=$(basename "$f")

  # Skip allowed uppercase conventions
  if echo "$BASENAME" | grep -qE "^($UPPERCASE_ALLOWED)$"; then
    continue
  fi

  # Skip non-doc files that commonly use mixed case (React components, etc.)
  # Only enforce for docs/ and config files
  if [[ ! "$f" =~ ^docs/ ]]; then
    continue
  fi

  # Check for spaces in filename
  if echo "$BASENAME" | grep -q ' '; then
    echo "RULE: No spaces in filenames"
    report_error "naming" "$f" "Use hyphens instead of spaces"
    echo ""
    continue
  fi

  # Check for camelCase or PascalCase (but allow all-caps like README)
  # Pattern: lowercase followed by uppercase = camelCase
  if echo "$BASENAME" | grep -qE '[a-z][A-Z]'; then
    echo "RULE: No camelCase in doc filenames"
    report_error "naming" "$f" "Use lowercase-with-hyphens naming"
    echo ""
    continue
  fi

done <<< "$FILES"

# =============================================================================
# RULE 9: Markdown files outside /docs must be README.md (or SKILL.md, AGENTS.md)
# =============================================================================

# Allow: README.md anywhere, SKILL.md anywhere, CLAUDE.md, AGENTS.md,
# and all .md files under .opencode/ (agent definitions, skill docs)
ALLOWED_MD_OUTSIDE="^README\.md$|/README\.md$|/SKILL\.md$|^CLAUDE\.md$|^AGENTS\.md$|^\.opencode/"

INVALID_MD_FILES=$(echo "$FILES" | grep '\.md$' | grep -v '^docs/' | \
  grep -vE "$ALLOWED_MD_OUTSIDE" || true)
if [[ -n "$INVALID_MD_FILES" ]]; then
  echo "RULE: Markdown files outside docs/ must be README.md, SKILL.md, CLAUDE.md, or AGENTS.md"
  while IFS= read -r f; do
    report_error "md-outside-docs" "$f" "Move to docs/ or rename to README.md"
  done <<< "$INVALID_MD_FILES"
  echo ""
fi

# =============================================================================
# Summary
# =============================================================================

echo "---"
if [[ $ERRORS -eq 0 ]]; then
  echo "All checks passed."
  exit 0
else
  echo "Found $ERRORS violation(s)."
  exit 1
fi
