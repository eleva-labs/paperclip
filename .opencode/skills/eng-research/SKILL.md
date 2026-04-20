---
name: eng-research
description: >
  Conduct structured research for a feature or spike. Reads requirements, file references,
  and web references to produce a research document with findings, options analysis, and
  recommendations. Use this when there are unknowns that need investigation before design
  or implementation.
---

# Research

Conduct structured research and produce a research document with findings, analysis, and recommendations.

## When to Use

- The technology is new to the project
- Multiple viable approaches exist and trade-offs are unclear
- A spike is needed to evaluate feasibility
- The human or `eng-feature-dev` orchestrator explicitly requests research
- Complexity assessment rated the task as Large or Spike

## When NOT to Use

- The problem domain is well-understood
- The implementation follows an established pattern in the codebase
- Existing code already demonstrates the approach
- Trivial or Small complexity tasks

## Inputs

- **Requirements text**: What needs to be researched and why
- **File references** (optional): Existing code or docs to analyze
- **Web references** (optional): URLs to external docs, libraries, or APIs
- **Workspace path**: Where to save the research document (e.g., `docs/temp/engineering/eng-foo/`)

## Outputs

- `{workspace}/research.md` — Primary research document using the research template
- `{workspace}/research-{topic}.md` — Additional topic-specific documents (if research spans multiple distinct areas)

**Strict boundary**: Research produces ONLY research artifacts. It must NOT produce design artifacts (schemas, file manifests, architecture diagrams). If research reveals a design direction, capture it as a recommendation — the actual design work happens in `eng-design`.

Formal review, when needed, is handled outside this producer skill via `eng-research-review`.

## Workflow

### Step 1: Gather Context

1. Read all provided file references. For each file, summarize what's relevant to the research question.
2. Fetch all provided web references. Extract key information.
3. When the question depends on external frameworks, APIs, tools, or standards, consult authoritative external documentation even if it was not pre-supplied.
4. If the workspace already has artifacts (prior research), read them for context.
5. Identify knowledge gaps — what questions remain unanswered?

### Step 2: Analyze

1. Organize findings by topic area.
2. For each option or approach discovered:
   - Document what it is
   - Document pros and cons
   - Assess fit for the project's architecture and patterns
   - Assess fit for the project's domain constraints
   - Note relevant best practices, standards, or conventions that support or constrain it
3. If comparing alternatives, use a structured comparison table with scored criteria.
4. If there are meaningful alternatives, make them explicit even when one option initially looks preferred.

### Step 3: Synthesize

1. Write the research document using the template at `docs/engineering/templates/research.md`.
2. Fill in all sections:
   - Research Question — clear statement of what we're investigating
   - Context — why this research is needed
   - Methodology — what sources were consulted
   - Findings — organized by topic area with evidence
   - Options Analysis — structured comparison of alternatives
   - Recommendation — clear pick with rationale
   - Open Questions — what still needs human input
   - Risks & Unknowns — what could go wrong
3. If the research spans multiple distinct topics, create additional `research-{topic}.md` files.
4. Keep the artifact concise, but complete enough for downstream design or planning to rely on it.

### Step 4: Save

1. Write the document to `{workspace}/research.md`.
2. Update the document's frontmatter `status` from `draft` to `complete`.
3. Update the workspace `README.md` activity log with: date, agent, "Completed research: {summary}".
4. Present a summary to the invoking skill/agent:
   - Key findings (2-3 bullets)
   - Recommended option
   - Open questions requiring human input

## Template

Uses: `docs/engineering/templates/research.md`

## Acceptance Criteria

- Research document exists in the workspace with all template sections filled
- All file references were read and analyzed
- All provided web references were fetched and analyzed
- Authoritative external documentation was consulted when the topic depends on external technology or standards
- Meaningful alternatives are documented when they exist
- Best practices or relevant standards are addressed when they materially affect the recommendation
- At least one recommendation is present with rationale
- Open questions are explicitly listed
- No design artifacts were produced (strict boundary)
