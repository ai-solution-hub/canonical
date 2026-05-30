# cmux Lane A — ID-56 {56.14} → {56.15} → {56.17} heading-cols disposition

You are a **SUB-ORCHESTRATOR** in an isolated git worktree on branch
`cmux-worker-id56-heading-*` (branched from main HEAD `e387975c`). Load the
`workflow-orchestration` skill. You are NOT a leaf worker: dispatch a `task-planner` for
the research/spec ({56.14}) and a `task-executor` + `task-checker` for the implementation
({56.15}), per the ratified executor→checker pattern. Do not author specs/code as your own
deliverable.

This lane has **THREE subtasks** and a **human-ratification gate in the middle** — you
cannot finish {56.15} without Liam's written disposition choice relayed through the OQ
channel.

## {56.14} — Heading-cols disposition RESEARCH-spec (do FIRST)

Author `docs/specs/id-56-content-model-invariants/heading-cols-disposition-RESEARCH.md`
(UK English, no fabrication, cite every claim as file:line). Audit the 4 heading-derived
columns on `content_chunks`: `heading_text`, `heading_level`, `heading_path`,
`parent_chunk_id`. NB the cocoindex chunking stage writes these as NULL / default `'{}'`
(heading-unaware budget-split chunking — see ID-56 {56.8}).

For EACH disposition option capture: (i) downstream impact — which consumers break/change;
(ii) schema-migration cost; (iii) historical-data implication (soft-archived `q_a_pair`
rows MAY retain populated heading values); (iv) a Liam-ratifiable recommendation. Options:

- **(a) keep nullable legacy** — columns stay, unused, NULL-by-default.
- **(b) drop columns** — remove all 4 from `content_chunks` + coordinated
  `search_content_chunks` RPC + Zod + consumer retirement.
- **(c) re-purpose for AST-aware boundaries** (tree-sitter) — OUT OF v1 SCOPE.

Consumer audit targets (grep + gitnexus): `search_content_chunks` RPC,
`lib/mcp/tools/search.ts`, `lib/mcp/tools/content.ts`, `lib/mcp/formatters/search.ts`.
TECH refs: §2.2 row C-13 heading-derived columns; `[GAP-CMI-004]`; RESEARCH §6 + §7
OQ-CMI-56-4. PRODUCT inv C-13, `[GAP-CMI-004]`.

Cite empirical OQ-3 checks via `python3 -c` (sandbox-disabled per CLAUDE.md) if you
inspect live data.

## RATIFICATION GATE (between {56.14} and {56.15})

When {56.14} is `done`, you MUST **emit an OQ packet** to the parent with your disposition
recommendation (a / b / c) + rationale + a recommended default, and **PAUSE in
`awaiting-decision`** — do NOT proceed to {56.15} and do NOT `/exit` until the parent
relays Liam's written ratification via the OQ decision file. Read
`.claude/skills/session-driver-cmux/oq-brief-fragment.md` for the exact emit/poll usage
contract. (Liam owns this product decision; you cannot make it.)

## {56.15} — implementation (GATED on the ratified disposition)

Implement per the ratified choice ONLY:

- **(a) keep nullable** — NO code/migration. Record `[GAP-CMI-004]` as `RESOLVED-(a)` in
  PRODUCT.md. (Already covered by Migration-2 nullability + {56.10} consumer fix-up.)
  {56.15} reduces to a closing-ack.
- **(b) drop columns** — author a CLI migration removing
  `heading_text`/`heading_level`/`heading_path`/`parent_chunk_id` from `content_chunks`;
  coordinated `search_content_chunks` RPC change + Zod schema + consumer call-site
  retirement in `lib/mcp/tools/search.ts` + `content.ts` + `lib/mcp/formatters/search.ts`;
  regen `database.types.ts`; record resolution in PRODUCT.md. **DDL via CLI only**
  (`supabase migration new` + `db push`), never MCP. **First action if (b):
  `supabase link --project-ref turayklvaunphgbgscat` (staging) — verify
  `cat supabase/.temp/project-ref` before any push.** All new PL/pgSQL
  `SET search_path = public, extensions`. migration-revoke-guard CI must PASS. The `.ts`
  consumer edits get `gitnexus_impact` before-edit passes (record verdicts in journal);
  the seeded worktree gitnexus index is read-only.
- **(c) re-purpose AST** — OUT OF v1 SCOPE. Do NOT implement inline. Emit an OQ to
  ESCALATE to the parent for a separate v1.1 Task, then stop.

## {56.17} — sequencing-doc §2.5 amend handoff packet

Author the handoff packet (for later Curator dispatch) amending
`docs/themes/canonical-pipeline/reference/canonical-pipeline-sequencing.md` §2.5 to
reflect the {56.14}/{56.15} chunking + heading-cols outcome. This is a doc/handoff
artefact — produce the packet; the parent's Curator applies it.

## Environment

`.env.local` seeded (`.worktreeinclude`). For disposition (b) you'll need `bun install`
(TS edits + `database.types.ts` regen) and the supabase CLI link above. {56.14}/{56.17}
are doc-only.

## Verification gate

- {56.14}/{56.17}: doc lints / internal-link sanity; no fabrication.
- {56.15}(b) only: `supabase db push` staging clean; `bun run test` green for the
  `search.ts`/`content.ts`/`formatters` edits; `database.types.ts` regenerated;
  migration-revoke-guard PASS; lint + tsc clean.

## Rules (non-negotiable)

- **task-planner ({56.14}) → task-executor + task-checker ({56.15}) pattern.**
  FAIL→fix→PASS before done.
- **NO ledger edits** — parent owns `docs/reference/*.json`.
- **NO `AskUserQuestion`** — use the OQ channel (deadlock risk). The ratification gate
  above is mandatory OQ usage.
- UK English; semantic tokens only for any UI; no barrel re-exports; relative paths only.
- Commit per subtask via `commit-commands` on your worker branch. Do NOT push.

## Final report

Before teardown write `<events_dir>/final_report.yaml`
(`.claude/cmux-events/<your-sid>/`). Schema:
`{summary, disposition_recommended, disposition_ratified, commits:[sha+subject], files_touched, migration_applied, OQs_for_parent, next_steps}`.
Short stdout summary too. Do not `/exit` while the ratification OQ (or any OQ) is
undecided.
