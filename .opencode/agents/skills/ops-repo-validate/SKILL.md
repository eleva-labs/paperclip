---
name: ops-repo-validate
description: >
  Validate repository structure and naming conventions. Checks that docs/ files
  are in valid team folders, filenames follow naming standards, and no prohibited
  files exist. Called from pre-commit hook and can be run manually.
---

# Repo Validate

Validate repository structure and naming conventions.

## Usage

```bash
# Check only staged files (for pre-commit hook)
bash .opencode/skills/ops-repo-validate/scripts/validate.sh --staged

# Check entire repo (manual validation)
bash .opencode/skills/ops-repo-validate/scripts/validate.sh --all
```

## What It Checks

### docs/ Structure Rules

- No files directly in `docs/` root (except `README.md`)
- No files in stale top-level folders (`docs/specs/`, `docs/decisions/`, `docs/research/`)
- `docs/temp/` files should NOT be committed (they're ephemeral workspaces)
- Valid team folder names: `product`, `engineering`, `growth`, `customer`
- Root index directories (`docs/constitution/`, `docs/templates/`) only contain `README.md`
- Source IDs in `docs/<team>/archive/<source-id>/` use correct team prefix

### Naming Standards

- Filenames are lowercase with hyphens (no spaces, no camelCase)
- Exception: `README.md`, `SKILL.md`, and other conventional uppercase names

### Security

- No `.env`, `credentials.json`, or other secret files staged

### Existing Rules (from pre-commit)

- Markdown files outside `/docs` must be `README.md` or `SKILL.md`

## Exit Codes

- `0` — All checks passed
- `1` — Violations found (prints details)
