---
name: content-creation
description: Guide the user through creating knowledge base content to fill template coverage gaps. Covers policy statements, evidence narratives, case studies, Q&A pairs, and capability descriptions. Use when the user wants to create content for a specific domain/subtopic, fill a template gap, or pastes gap context from the web app.
---

# Content Creation

Structured guidance for creating KB content that fills template coverage gaps. Each requirement type has a specific creation flow that ensures the content is complete, well-classified, and immediately useful for bid responses.

## When to Use This Skill

- The user pastes gap context from the web app's "Create content" CTA
- The user asks to create content for a specific domain or subtopic
- The user requests help filling a template gap
- After running `get_template_gaps` and wanting to address the results

## Step 1: Understand the Requirement

### From Clipboard Context (Web App CTA)

If the user provides requirement context (pasted from the web app), parse:
- **requirement_text** — what the template asks for
- **requirement_type** — policy / statement / evidence / data / narrative / declaration / reference
- **section_name** — which template section this belongs to
- **matching_keywords** — terms that help classify the content
- **domain / subtopic** — taxonomy classification

### From Free-Text Request

If the user describes what they want to create without structured context:

1. Call `get_template_gaps` with the relevant template name to find unmet requirements
2. Present the most relevant gap(s) and confirm which one the user wants to address
3. Extract the requirement type, domain, and subtopic from the gap data

### Requirement Types

| Type | What the Template Needs | Content Type to Create |
|------|------------------------|----------------------|
| **Policy** | Governance document showing organisational commitment | `policy` |
| **Statement** | Declarative capability or compliance claim | `capability` or `compliance` |
| **Evidence** | Proof of delivery — real project example | `case_study` |
| **Data** | Specific facts — certifications, dates, figures | `certification` or `compliance` |
| **Narrative** | Extended methodology or approach description | `methodology` or `article` |
| **Declaration / Q&A** | Standard question with a reusable answer | `q_a_pair` |

## Step 2: Fetch Existing Context

Before creating new content, search for what already exists.

### Search the Knowledge Base

Call `search_knowledge_base` with the requirement text. This provides:
- Existing content the user can reference or extend
- Tone and style examples from the organisation's KB
- Evidence of what is already documented

### Search the Q&A Library

Call `search_qa_library` if:
- The requirement type is `declaration`
- A Q&A pair would be an appropriate format for the content
- You want to check for existing standard answers on the topic

### What to Do With Search Results

- If strong existing content covers the requirement → tell the user; no new item may be needed
- If partial content exists → use it as a starting point and reference
- If nothing relevant exists → proceed with fresh creation

## Step 3: Guide Creation by Requirement Type

### Policy (`requirement_type = 'policy'`)

1. Ask the user for:
   - Policy scope and applicability
   - Key commitments and principles
   - Review frequency
   - Responsible parties
2. Draft a structured policy statement with sections:
   - **Purpose** — why the policy exists
   - **Scope** — what it covers
   - **Commitments** — specific obligations
   - **Review schedule** — when and how it is reviewed
3. Use `create_content_item` with `content_type = 'policy'`

### Statement (`requirement_type = 'statement'`)

1. Ask the user for the key facts and commitments
2. Draft a declarative statement suitable for procurement responses:
   - Lead with the commitment or capability
   - Support with evidence (standards, certifications, metrics)
   - Keep it authoritative and specific
3. Use `create_content_item` with `content_type = 'capability'` or `'compliance'`

### Evidence (`requirement_type = 'evidence'`)

1. Ask the user for project details:
   - Client name (anonymise if needed — e.g. "a major NHS Trust")
   - Challenge or requirement
   - Approach and methodology
   - **Measurable outcomes** — always prompt for specific figures
2. Draft as a case study:
   - **Challenge** — what the client needed
   - **Approach** — how the organisation delivered
   - **Outcome** — measurable results with specific figures
3. Use `create_content_item` with `content_type = 'case_study'`

**Important:** If the user provides vague outcomes ("it went well", "the client was happy"), prompt for specific metrics — percentages, timescales, cost savings, volumes. Evidence without measurable outcomes scores poorly in bid evaluations.

### Data (`requirement_type = 'data'`)

1. Ask the user for specific data points:
   - Certification names and numbers
   - Dates of award and expiry
   - Figures, statistics, or thresholds
2. Create a structured record with all data clearly presented
3. Use `create_content_item` with `content_type = 'certification'` or `'compliance'`

### Narrative (`requirement_type = 'narrative'`)

1. Ask the user for:
   - Key themes to cover
   - Evidence and examples to include
   - Target audience and tone
2. Draft an extended narrative (method statement style):
   - Clear structure with logical flow
   - Each section makes a distinct point
   - Evidence woven throughout, not bolted on at the end
3. Use `create_content_item` with `content_type = 'methodology'` or `'article'`

### Q&A Pair (`requirement_type = 'declaration'` or general)

1. Formulate a clear, standard question from the requirement text
2. Ask the user for the answer content
3. Structure the content with the question as the title and the answer as the body
4. Use `create_content_item` with `content_type = 'q_a_pair'`

## Step 4: Create and Classify

Once the content is drafted and the user approves:

1. **Create** — Call `create_content_item` with:
   - `title` — clear, descriptive title
   - `content` — the full content text
   - `content_type` — as determined by requirement type
   - `primary_domain` — from the requirement's taxonomy
   - `primary_subtopic` — from the requirement's taxonomy
   - `priority` — set based on template importance (default: `medium`)

2. **Classify** — Call `classify_content` on the new item to verify/refine classification
   - Check the returned classification matches the intended domain/subtopic
   - If it differs, flag to the user: "Auto-classification assigned [X] but the target was [Y] — which is correct?"

3. **Summarise** — Call `generate_summary` on the new item to create the AI summary

## Step 5: Verify Coverage Improvement

After creation, verify the gap has been addressed:

1. Call `get_template_gaps` for the relevant template
2. Check whether the requirement's status changed from `gap` to `partial` or `strong`
3. Report the result to the user:
   - ✓ "Coverage for [requirement] improved from gap to strong"
   - △ "Coverage improved to partial — additional content may help strengthen this"
   - ✗ "Coverage unchanged — the content may need different keywords or classification"

If coverage didn't improve, investigate:
- Was the classification correct?
- Do the matching keywords align with the requirement?
- Is the content substantial enough?

## Step 6: Iterate or Continue

After verifying, offer the user options:

- **Refine** — Use `update_content_item` to improve the content
- **Strengthen** — Create additional content for the same requirement to move from `partial` to `strong`
- **Next gap** — Move to the next gap in the template
- **Done** — Content creation complete

## Quality Guardrails

### Minimum Content Length

Warn the user if content falls below these thresholds:

| Content Type | Minimum Length |
|-------------|---------------|
| Article, methodology, policy | 200 characters |
| Case study | 300 characters |
| Q&A pair | 100 characters |
| Capability, compliance, certification | 150 characters |

### UK English

All generated content **must** use UK English conventions:
- "organisation" not "organization"
- "colour" not "color"
- "programme" not "program" (when referring to a plan/initiative)
- "licence" (noun), "license" (verb)
- DD/MM/YYYY date format
- "whilst", "amongst" are acceptable

### Evidence Specificity

Case studies and evidence must include measurable outcomes. Prompt the user for:
- Percentage improvements
- Timescales (delivered in X weeks)
- Cost savings (£X saved)
- Volumes (X users, X transactions)
- Named standards met

### Classification Verification

After `classify_content` runs, compare the result against the intended domain/subtopic. If they differ:
1. Present both the intended and auto-assigned classifications
2. Ask the user which is correct
3. If the auto-classification is wrong, note that the content may need stronger keyword signals for the intended domain

## MCP Tools Reference

| Tool | When to Use |
|------|------------|
| `get_template_gaps` | Find unmet requirements to fill |
| `search_knowledge_base` | Find related content for context and deduplication |
| `search_qa_library` | Find existing Q&A pairs for reference |
| `create_content_item` | Create the new KB item |
| `update_content_item` | Iterate on content after creation |
| `classify_content` | Auto-classify the new item |
| `generate_summary` | Generate AI summary for the new item |
| `get_template_coverage` | Check overall template coverage score |

## Related Skills

- **@search-strategy** — How to construct effective search queries
- **@knowledge-synthesis** — How to combine search results into coherent context
- **@bid-writing** — How to use created content in bid responses
- **@content-governance** — How to assess and maintain content quality over time
