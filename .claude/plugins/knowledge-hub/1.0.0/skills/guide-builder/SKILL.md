---
name: guide-builder
description:
  Create or update knowledge base guides that organise content into structured,
  domain-scoped views. Walks through intent detection, metadata collection,
  section design, source validation, and publish decisions. Use when the user
  wants to create a new guide, update an existing guide, or restructure guide
  sections.
---

# Guide Builder

Structured guidance for creating and updating knowledge base guides. Guides
organise KB content into domain-scoped, section-based views — each section
defines what content belongs there by subtopic, layer, and content type.

## When to Use This Skill

- The user asks to create a new guide (sector, product, company, research, or
  custom)
- The user wants to update an existing guide's metadata or sections
- The user requests help structuring a guide's section layout
- After reviewing coverage gaps and wanting to organise content by domain

## Step 1: Detect Intent and Check Existing Guides

### Discover what already exists

Call `list_guides` to see all current guides. If the user mentions a specific
guide by name or domain, call `get_guide` with the slug or ID to inspect its
current state.

### Determine intent

- **Create** — user wants a new guide that does not yet exist
- **Update** — user wants to modify an existing guide's metadata or sections
- **Restructure** — user wants to reorganise sections within an existing guide

## Step 2: Collect Guide Metadata

Gather the following from the user through dialogue:

| Field             | Required | Notes                                                                         |
| ----------------- | -------- | ----------------------------------------------------------------------------- |
| **name**          | Yes      | Human-readable guide name                                                     |
| **slug**          | Yes      | URL-safe identifier (lowercase, hyphens, numbers). Suggest one from the name. |
| **guide_type**    | Yes      | One of: `sector`, `product`, `company`, `research`, `custom`                  |
| **description**   | No       | Brief description of the guide's purpose                                      |
| **domain_filter** | No       | Primary domain this guide covers (must match a valid taxonomy domain)         |
| **is_published**  | Yes      | Whether to publish immediately or keep as draft                               |
| **display_order** | No       | Ordering position (default: 0)                                                |

### Validation

- Confirm the slug is unique — `list_guides` would show any collision
- If `domain_filter` is provided, verify it exists in the taxonomy by consulting
  `kb://taxonomy`

## Step 3: Propose Sections

Use the `kb://taxonomy` resource to understand the domain structure and propose
sections.

### Section design principles

- Each section should map to a coherent slice of the domain (e.g. a subtopic, a
  content type, or a layer)
- Use `subtopic_filter` to scope sections to specific subtopics within the
  domain
- Use `expected_layer` to indicate the expected depth (brief, detail, reference)
- Use `content_type_filter` to restrict to specific content types where
  appropriate
- Mark critical sections as `is_required: true`

### Guardrails

- **Section count warning:** If the proposed section count exceeds 20, warn the
  user that guides with too many sections become unwieldy. Suggest grouping
  related subtopics.
- **Required-section ratio:** If 100% of sections are marked as required,
  confirm with the user — at least some sections should typically be optional to
  allow for progressive content building.
- **Domain/subtopic validation:** Every `subtopic_filter` value should
  correspond to a real subtopic in the taxonomy. Verify against `kb://taxonomy`.

### Present the section plan

Show the user a table of proposed sections with:

- Section name
- Description
- Expected layer
- Subtopic filter
- Required status
- Display order

Get approval before proceeding.

## Step 4: Validate Source Content

Before creating the guide, verify that content exists for the proposed sections.

### Search for matching content

Call `search_knowledge_base` with terms relevant to each section. This helps:

- Confirm that sections will not be empty on creation
- Identify content gaps that need addressing
- Validate that the section filters will match real content

### Report coverage

For each proposed section, report:

- **Strong** — multiple relevant items found
- **Partial** — some relevant items, but gaps exist
- **Empty** — no content matches this section's scope

If most sections would be empty, discuss with the user whether to:

- Proceed anyway (content will be added later)
- Adjust section definitions to match available content
- Create content first using `@content-creation`

## Step 5: Decide Publish State

Discuss with the user:

- **Draft (is_published: false)** — guide is created but not visible to end
  users. Use when sections need content population first.
- **Published (is_published: true)** — guide is immediately visible. Use when
  the guide structure is final and content coverage is adequate.

Recommend draft for new guides unless content coverage is strong across most
sections.

## Step 6: Create or Update

### Creating a new guide

Call `create_guide` with:

- All metadata fields from Step 2
- All sections from Step 3 (as the `sections` array)

### Updating an existing guide

Call `update_guide` with:

- The guide `id`
- Changed metadata fields in `fields`
- New or updated sections in `sections` (sections with an `id` are updated;
  sections without an `id` are inserted)
- A `reason` explaining the change

## Step 7: Verify Result

After creation or update, call `get_guide` to verify:

- Guide metadata is correct
- All sections were created/updated as expected
- Section ordering is correct
- Published status matches intent

Report any discrepancies to the user.

## Step 8: Optionally Link to Coverage

If the user wants to understand how well the guide is covered:

- Use `search_knowledge_base` with domain-specific queries for each section
- Report which sections have strong, partial, or no coverage
- Suggest using `@content-creation` to fill gaps
- Suggest using `@coverage` for a broader coverage analysis

## Quality Guardrails

### UK English

All guide names, descriptions, and section names **must** use UK English:

- "organisation" not "organization"
- "colour" not "color"
- "programme" not "program" (when referring to a plan/initiative)

### Section Count

- Warn if more than 20 sections are proposed
- Suggest merging related sections or creating sub-guides

### Required Section Ratio

- If all sections are marked required, ask: "Are all of these truly required, or
  should some be optional for progressive content building?"

### Domain Validation

- Verify `domain_filter` and `subtopic_filter` values against `kb://taxonomy`
- Flag any values that do not match known taxonomy entries

## MCP Tools Reference

| Tool                    | When to Use                                   |
| ----------------------- | --------------------------------------------- |
| `list_guides`           | Discover existing guides                      |
| `get_guide`             | Inspect a specific guide and its sections     |
| `create_guide`          | Create a new guide with sections              |
| `update_guide`          | Update guide metadata or sections             |
| `search_knowledge_base` | Validate content exists for proposed sections |

## Related Skills

- **@content-creation** — Create content to fill guide section gaps
- **@coverage** — Analyse domain coverage to inform guide structure
- **@search-strategy** — Construct effective queries to validate section content
