# Skills Framework

Skills are reusable workflows packaged as documentation plus optional scripts.

## Structure

Each skill is a directory containing:

```
{skill-name}/
├── SKILL.md              # Documentation: description, interface, workflow
└── scripts/
    └── {script}.sh       # Implementation (bash)
```

## Naming and scope

- Use concise, durable names that describe the workflow outcome.
- Keep detailed behavior in each skill's `SKILL.md`; this README stays framework-level.
- Related skills may form a family with a shared prefix or suffix pattern, such as `eng-*-review` for artifact-specific engineering reviews.

## Skill families

Common families in this repo include:

- `ops-*` — workspace, repo, and operational workflows
- `eng-*` — engineering lifecycle workflows such as research, design, planning, execution, and review
- `eng-*-review` — leaf formal review skills scoped to one artifact type

Producer and reviewer skills may intentionally repeat a few critical guardrails (for example completeness or acceptance readiness) when that reduces ambiguity, but detailed rubrics should stay in the leaf skill that owns them.

Refer to each skill directory's `SKILL.md` for the canonical contract.

## Adding a skill

1. Create a directory in `.opencode/skills/{your-skill-name}/`
2. Write `SKILL.md` with the skill description and usage contract
3. Add `scripts/` only if the workflow needs executable helpers
4. Reference the skill from agent instructions

## Project-specific skills

For skills tied to a specific deployment or stack, keep them in `.opencode/skills/` alongside the generic ones and document the scope clearly in that skill's `SKILL.md`.

## Invocation

Agents load skills through the OpenCode skill tool. Keep this README index-level; put workflow details in each skill's `SKILL.md`.
