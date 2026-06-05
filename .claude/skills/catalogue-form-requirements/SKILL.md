---
name: catalogue-form-requirements
description:
  Use when promoting an ingested form instance's extracted questions into the
  global, reusable requirement catalogue (Path C). Reads one
  form_templates instance's fields, classifies each into a
  form_template_requirements row (requirement type + matching keywords +
  guidance + embedding), and writes them only after explicit per-row human
  confirmation by an admin/editor caller. Triggered when a human asks to
  catalogue, promote, or seed catalogue requirements from a specific ingested
  form. NOT for pipeline ingest (which never auto-writes the catalogue).
allowed-tools: Read, Edit, Write, Bash
---

# catalogue-form-requirements — Path C cataloguing skill

Promotes the extracted questions of one ingested form **instance** into the
global, reusable **catalogue** of requirements (`form_template_requirements`)
that the matching subsystem (T10) reads against.

This is **Path C** in the form-extraction subsystem (TECH §2.7, PRODUCT
Inv-20..Inv-25). It is the **only** way catalogue rows are created: pipeline
ingest fills instance fields but never auto-writes the catalogue (Inv-20). The
catalogue is authored through an explicit, human-confirmed step (Inv-21).

## When to use

- A human asks to "catalogue", "promote", or "seed catalogue requirements" from
  a specific ingested form instance.
- After a {52.12}-style instance write has produced a `form_templates` row whose
  `form_template_fields` you want to turn into reusable requirements.

## When NOT to use

- For pipeline ingest. Ingest must NOT write the catalogue (Inv-20). If you find
  yourself wanting the pipeline to auto-catalogue, stop — that violates the
  instance-vs-catalogue distinction.
- For matching/scoring/ranking over the catalogue — that is T10's spec, out of
  scope here (Inv-22 boundary).

## Inputs

| Input | Required | Meaning |
|---|---|---|
| `form_templates.id` (UUID) | **yes** | The ingested instance to catalogue from. Its `form_template_fields` are the source questions. |
| `template_type` (a `form_types.key`) | no | Override the catalogue rows' `template_type`. Defaults to the instance's own `form_type`. |
| human-confirmation flag (`--confirm`) | **no default** | Must be passed explicitly to write. Without it, the run is PREVIEW only — nothing is written (Inv-21). |

## Output

An executable TS file at
`scripts/catalogue-from-instance-<form_template_id>.ts` — a per-form copy that
drives the generic template `scripts/catalogue-from-instance.ts` with the
instance id baked in. The generic template can also be run directly; the
per-form copy exists so the intended run is reviewable in PR / `task-view` and
auditable in commit history.

The script, when run, performs the **read → classify → embed → confirm → write**
flow:

1. **Read** (`form_template_fields` for the instance, read-only — never mutates
   instance state).
2. **Classify** each field via Anthropic (`claude-opus-4-6`) into a
   `requirement_type` + `matching_keywords` + `matching_guidance` shape. The
   prompt replicates the `Q_A_FORM_PROMPT` pattern (verbatim text, strict JSON)
   extended for catalogue classification.
3. **Embed** each requirement via `text-embedding-3-large`, dimensions 1024
   (the same config as pipeline Stage-4, so the catalogue is consistent with
   T10's read shape). The vector is serialised via `JSON.stringify` for the
   Supabase vector param.
4. **Confirm** — each candidate row is printed to stdout and the script HALTS
   pending an explicit `y/n` per row. Declined rows are not written (Inv-21).
5. **Write** — confirmed rows are written to `form_template_requirements` via
   `tryQuery()` (per-row write), but only after the auth gate passes.

Re-runs UPSERT on the natural key
`(template_name, template_version, section_ref, question_number)` — row `id`s
are preserved and unchanged-text embeddings reused, so re-cataloguing the same
instance is safe and idempotent ({52.22}).

## Auth gate (Inv-24)

The write step calls `getAuthorisedClient(['admin', 'editor'])` against the
actual database session. An unauthorised caller (e.g. viewer role,
unauthenticated) is refused: the failure reason is routed through
`authFailureResponse(auth)` to the correct status, the refusal is logged, and
the script exits without writing any row. Only admin/editor callers may
populate the catalogue.

## Catalogue row shape (Inv-22 / Inv-23)

Each written row carries the fields T10 reads: `template_type`
(→ `form_types.key` FK), `requirement_type` (plain string from the
CHECK-constrained set), `matching_keywords`, `matching_guidance`,
`requirement_embedding` (vector(1024)), `is_mandatory`, and `section_name`.

Rows carry **no** `workspace_id` — the catalogue is global and reusable across
workspaces (Inv-23).

## How to emit a per-form copy

Generate `scripts/catalogue-from-instance-<form_template_id>.ts` that invokes
the generic template with the id baked in, for example:

```ts
#!/usr/bin/env bun
// Catalogue-from-instance for form_templates.id <form_template_id>.
// Generated by the catalogue-form-requirements skill. Review before running.
process.argv.push('--form-template-id', '<form_template_id>');
await import('./catalogue-from-instance.ts');
```

Then run it:

```bash
# Preview (no write — Inv-21):
bun run scripts/catalogue-from-instance-<form_template_id>.ts

# Write (admin/editor only — Inv-24), per-row y/n at the prompt:
bun run scripts/catalogue-from-instance-<form_template_id>.ts --confirm
```

Or run the generic template directly:

```bash
bun run scripts/catalogue-from-instance.ts --form-template-id <uuid> \
  [--template-type <form_types.key>] [--confirm]
```

## Implementation notes

- Helpers live in `lib/catalogue/from-instance.ts` (direct file imports, no
  barrels — CLAUDE.md). The script is a thin CLI wrapper over them.
- Behaviour is unit-tested in
  `__tests__/lib/catalogue/from-instance.test.ts` (Inv-21 confirmation gate +
  Inv-24 auth gate, Anthropic mocked at the SDK boundary).
- This skill does NOT call any `mempalace_*` / `gitnexus_*` MCP tools — it is a
  pure read → classify → embed → confirm → write flow (TECH §2.7).
