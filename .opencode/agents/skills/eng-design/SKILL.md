---
name: eng-design
description: >
  Create a technical design document from requirements and research. Captures architecture
  decisions, Zod schemas, API contracts, file manifest, and testing strategy. The design
  feeds directly into the implementation plan. Use this for Medium, Large, or Spike features
  that need architectural planning before implementation.
---

# Design

Create a technical design document that specifies what to build and how.

## When to Use

- Any change touching schemas, DB, or new architectural patterns
- Any change spanning more than one layer of the four-layer model
- Medium, Large, or Spike complexity tasks
- The human or `eng-feature-dev` orchestrator explicitly requests design

## When NOT to Use

- Trivial changes (< 2h, 1-3 files)
- Small changes following exact existing patterns (use light design inline in impl plan instead)
- Pure research tasks with no implementation

## Inputs

- **Requirements text**: What needs to be built
- **Research document** (optional): `{workspace}/research.md` if research was conducted
- **Workspace path**: Where to save the design document
- **Existing codebase context**: Read relevant existing code to understand patterns

## Outputs

- `{workspace}/design.md` — Primary design document using the design template
- `{workspace}/design-{subsystem}.md` — Additional subsystem-specific documents (for large designs)

**Strict boundary**: Design produces ONLY design artifacts. It must NOT produce research or analysis artifacts. If design work reveals unknowns that need investigation, report back to the orchestrator (`eng-feature-dev`) to loop back to `eng-research` rather than producing ad-hoc analysis documents.

Formal review, when needed, is handled outside this producer skill via `eng-design-review`.

## Workflow

### Step 1: Understand Scope

1. Read the requirements text thoroughly.
2. Read the research document if it exists — especially the recommendation and open questions.
3. Read existing code patterns relevant to the feature:
   - Similar features already implemented in the codebase
   - Schema patterns in `packages/core/schemas/`
   - Service patterns in `apps/web/lib/services/`
   - DB adapter patterns in `apps/web/lib/db/`
   - UI patterns in `apps/web/app/(dashboard)/`
4. Identify architectural boundaries — which layer does each piece belong to?
   - Core (schemas, constants, pure functions)
   - Adapters (DB, AI, email)
   - Services (business logic orchestration)
   - Server Actions (UI layer)
5. When the design depends on framework, library, platform, API, or standard behavior, validate the relevant assumptions against authoritative external documentation.

### Step 2: Design Architecture

1. Determine which layers of the four-layer model are affected.
2. Choose the level of detail needed for the requested bar (for example MVP vs production-ready), but still cover all affected contracts, files, validation points, and tests.
3. For each affected layer, design the interfaces:
   - Zod schemas (input/output shapes) — write the FULL schema definitions, not descriptions
   - Function signatures with TypeScript types
   - Data flow between layers
4. Design database schema changes if applicable:
   - Drizzle schema additions/modifications
   - Migration strategy (MUST be backwards-compatible)
5. Design UI changes if applicable:
   - Route structure
   - Component hierarchy
   - Server Action signatures
6. Add the most relevant design-type-specific detail for the task, such as API-heavy contracts, schema-heavy validation/data evolution, UI-flow-heavy user states, or integration-heavy failure and retry behavior.

### Step 3: Specify Details

1. Write the design document using the template at `docs/engineering/templates/design.md`.
2. Fill in all sections:
   - Overview — what, why, who uses it
   - Architecture — layers affected, data flow diagram
   - Schema Definitions — FULL Zod schema code blocks (not prose descriptions)
   - API / Function Contracts — signatures with behavior and error cases
   - Database Changes — Drizzle schema and migration strategy (if applicable)
   - Error Handling — error types, when they trigger, recovery
   - Testing Strategy — what to test at each level (unit/integration/E2E)
   - File Manifest — EVERY file to create or modify, with owning agent
   - Key Design Decisions — decisions made with rationale and rejected alternatives
   - Open Questions — anything needing human input
   - Deferred Items — what's out of scope and when to revisit
3. Reference existing patterns by file path where the design follows established conventions.
4. Keep the document concise, but complete enough that implementation planning can cover the full intended scope without guesswork.

### Step 4: Save

1. Write the document to `{workspace}/design.md`.
2. Update the document's frontmatter `status` from `draft` to `complete`.
3. Update the workspace `README.md` activity log with: date, agent, "Completed design: {summary}".
4. Present a summary to the invoking skill/agent:
   - Architecture overview (1-2 sentences)
   - File count (new + modified)
   - Key design decisions (2-3 bullets)
   - Open questions requiring human input

## Template

Uses: `docs/engineering/templates/design.md`

## Acceptance Criteria

- Design document exists in the workspace with all template sections filled
- All affected layers of the four-layer model are addressed
- External-doc validation is captured when the design depends on external behavior
- Zod schemas are fully specified as code blocks (not just described in prose)
- File manifest lists every file to create/modify with owning agent
- Testing strategy is specified with concrete test types
- Design is complete enough for implementation planning without material gaps in architecture, contracts, validation, files, or testing
- Design is consistent with engineering constitution:
  - No classes — pure functions only
  - Integer CRC amounts — no decimals
  - No barrel files — direct subpath imports
  - No `any` types — use `unknown` or proper types
- No research or analysis artifacts were produced (strict boundary)
