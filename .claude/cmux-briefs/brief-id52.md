# cmux leaf-executor brief — ID-52 lane: {52.15} + {52.16}

You are a LEAF EXECUTOR in an isolated git worktree (branch `cmux-worker-id52-*`),
branched from `main`. Implement two Subtasks of Task ID-52 (form-extraction subsystem),
commit each, then `/exit`. You are NOT a sub-orchestrator — implement directly. Use
RELATIVE paths only.

## First actions (MANDATORY, in order)

1. `supabase link --project-ref turayklvaunphgbgscat` then
   `cat supabase/.temp/project-ref` to confirm STAGING. NEVER `db push` to prod.
2. Read your Subtask details:
   `jq -r '.tasks[] | select(.id=="52") | .subtasks[] | select(.id==15 or .id==16) | "{\(.id)} \(.title)\nDETAILS: \(.details)\nTEST: \(.testStrategy)\n---"' docs/reference/task-list.json`
3. Read the specs: `docs/specs/id-52-form-extraction/{PRODUCT,TECH,PLAN}.md` — the
   {52.15}/{52.16} slices. The Path-B deterministic extractors + Path-C cataloguing
   pipeline (already shipped, {52.1}-{52.14}) are the REPLACEMENT for the app-side analyse
   route you are retiring.
4. The worktree shares the parent gitnexus index READ-ONLY — do NOT run
   `gitnexus analyze`. Use `gitnexus_impact`/`gitnexus_context` or ast-dataflow for blast
   radius.

## Scope (ONLY these two)

- **{52.15}** Retire the app-side `analyse/route.ts` + UI rewire + `template_analyse`
  queue removal. The synchronous app-side analyse is superseded by the pipeline-owned
  Path-B/Path-C flow. BEFORE deleting: run `gitnexus_impact` on the route handler + the UI
  components that call it + the `template_analyse` queue — report the blast radius, then
  rewire the UI to the new flow (thin folder-drop / pipeline path) and remove the dead
  queue. No orphaned imports/callers left.
- **{52.16}** Acceptance fixtures end-to-end + Inv-26 AI-invisible review. Build the
  end-to-end acceptance fixtures per the PLAN, and apply the Inv-26 review (user-facing
  copy must be AI-invisible: UK English, no emoji, no AI tells/boilerplate). See
  `docs/specs/id-52-form-extraction/PRODUCT.md` Inv-26.

## Discipline

- TDD: extend tests first. `bun run test <file>` for Vitest; `bun run test:e2e` only if
  the fixture work needs it (heavy — scope narrowly). Proxy gotcha: any NEW public route
  must be added to `publicRoutes` in `proxy.ts` or it 302s to /login (likely N/A for a
  retirement, but watch the UI rewire).
- Tool-discipline: blast-radius (`gitnexus_impact` / ast-dataflow `callers`) BEFORE
  deleting the route or editing shared UI symbols — report it; `gitnexus_detect_changes`
  before each commit. This is the lane with the highest deletion blast radius — be
  thorough.
- Commit PER Subtask. Messages:
  `refactor(forms): {52.15} retire app-side analyse route + UI rewire` /
  `test(forms): {52.16} e2e acceptance fixtures + Inv-26 review`. End every message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **DO NOT edit any ledger JSON (`docs/reference/*.json`)** — the PARENT owns ledger
  writes.
- **DO NOT use AskUserQuestion** — use the OQ-escalation channel
  (`.claude/skills/session-driver-cmux/oq-brief-fragment.md`) for blocking questions.
  {52.15} is a deletion — if the blast radius reveals a live consumer you can't safely
  rewire, EMIT an OQ rather than guess.

## Finish

End with a FINAL REPORT as your last message: per-Subtask commit SHA, test results, the
{52.15} deletion blast-radius summary, any OQ / incomplete item. Then `/exit`.
