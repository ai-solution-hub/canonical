# Cmux Brief — subo-id-56-wave-a — ID-56 Wave-A ({56.5} RecursiveSplitter config spike)

**Session:** S278. **Worker name:** `subo-id-56-wave-a`. **Base branch:** `main` (worktree
branched from current HEAD).

## You are a SUB-ORCHESTRATOR, not a leaf worker

Load `workflow-orchestration` first. DISPATCH a `task-executor` via the built-in `Agent`
tool to author + run the spike, then GATE with a `task-checker` (variant=standard) BEFORE
committing. Do NOT author the spike script/doc directly as your own deliverable. Commit on
your worker branch (`commit-commands`); surface the recommendation + Open Questions via
the OQ-escalation channel (`docs/specs/id-43-oq-escalation/PRODUCT.md`).

## Scope — exactly ONE Subtask: {56.5}

Implement **only** `{56.5}` on `docs/reference/task-list.json` ID-56. Deps `[]`. Status
`pending`.

**This is a research SPIKE**, not a production-code wave. Deliverable = a recall@k eval
doc + a Liam-ratifiable recommendation for `chunk_size` / `chunk_overlap` /
`min_chunk_size`. The ratified values **gate {56.8}** (the chunking stage cannot dispatch
until Liam ratifies in writing). Do NOT dispatch any other {56.x}. {56.14}/{56.15} are
PENDING-NEXT-SESSION.

## The spike contract (full detail is in the ledger {56.5} `details` — read it)

Author a one-off spike script exercising
`cocoindex.ops.text.RecursiveSplitter().split(corpus_sample, chunk_size=<x>, chunk_overlap=<y>)`
across three pairs **A/B/C: (1000,100), (2000,200), (4000,400)**. For each variant:

1. Split the corpus sample with that variant's `chunk_size`/`chunk_overlap`.
2. Embed the chunks via the SAME
   `LiteLLMEmbedder('text-embedding-3-large', dimensions=1024)` the chunking stage will
   use (C-30).
3. Score a representative query set with **recall@k for k in {1, 5, 10}**.

**Corpus sample:** 10-20 representative UK procurement docs from staging (RFP / SQ /
framework-agreement / commercial-attachment mix). Source these from staging content or
`docs/testing/test-data/`. **If you cannot locate a representative corpus sample, STOP and
OQ-escalate to the parent** — do not fabricate a corpus or run on a trivial sample.

**Outputs:**

- `docs/research/id56-5-recursive-splitter-eval.md` — recall@k table per variant (3
  variants × 3 k-values) + a Liam-ratifiable recommendation.
- Spike script under `scripts/spikes/recursive-splitter-eval.{ts|py}` (author judgment —
  Python is the natural fit given cocoindex + LiteLLM).

## ★ V-1 TRAP + V-11 signature (NON-NEGOTIABLE — recurrence of the S252/S234 trap)

- **DO NOT cite or import `cocoindex.functions.SplitRecursively`** — it is **ABSENT in
  `cocoindex==1.0.3`** (this exact mistake recurred S234 with `ExtractByLlm` and S276).
  Use `cocoindex.ops.text.RecursiveSplitter`.
- **V-11 signature:** constructor `RecursiveSplitter(*, custom_languages=None)`;
  `.split(text, chunk_size, *, min_chunk_size=None, chunk_overlap=None, language=None) -> list[Chunk]`;
  `min_chunk_size` defaults to `chunk_size/2`; `Chunk = {text:str, start:int, end:int}`.
- **First Executor action: verify the import resolves** against the installed `cocoindex`
  (`python3 -c "from cocoindex.ops.text import RecursiveSplitter"`) before building the
  eval. If the symbol path differs in the installed version, STOP and OQ-escalate — do NOT
  guess an alternative API.

## Spec refs (renamed spec dir path)

- `docs/specs/id-56-content-model-invariants/TECH.md` §2.X RecursiveSplitter config
  (placeholder defaults chunk_size=2000 / chunk_overlap=200 / min_chunk_size=default — the
  spike tests these empirically); §4 Risks row 1 (config drift).
- `docs/specs/id-56-content-model-invariants/PRODUCT.md` C-10 (short-doc single-row
  threshold), C-11 (budget-bounded split), C-12 (short-trailing-chunk policy via
  `min_chunk_size`).
- `docs/specs/id-56-content-model-invariants/RESEARCH.md` §7 OQ-CMI-56-5 (defer-to-spike
  ratification).

## ★ Sandbox gotcha

The spike runs **`dangerouslyDisableSandbox: true`** (cocoindex / LiteLLM mmap convention
— they fail under the filesystem sandbox). Brief the Executor accordingly. LiteLLM
embedding calls hit the real OpenAI `text-embedding-3-large` endpoint — `.env.local` (with
the API key) is copied into the worktree via `.worktreeinclude`. Confirm the key is
present before running; if absent, OQ-escalate.

## Code-intelligence discipline

Spike is `.py` (or `.ts`) NEW file + a `.md` doc — no existing-symbol modification.
gitnexus impact discipline N/A (greenfield spike file). If the script ends up `.ts`, no
symbol edits either. No `gitnexus_impact` required; note "greenfield spike — no symbol
modification" in the journal.

## Dispatch cadence

1. Dispatch `task-executor` Agent with the {56.5} brief from the ledger `details` + the
   V-1 trap + sandbox gotcha above.
2. Dispatch `task-checker` Agent (variant=standard): verify the recall@k table covers all
   3 variants × 3 k-values, the corpus is genuinely representative (not
   trivial/fabricated), and the recommendation is grounded in the data.
3. Checker PASS → cherry-pick + append `<info added on …>` journal block. **Leave {56.5}
   status `in_progress` (NOT done)** until Liam ratifies the recommended values — flip to
   `done` only on ratification.
4. **OQ-escalate the recommendation to the parent** for Liam's written ratification of
   `chunk_size` / `chunk_overlap` / `min_chunk_size`. This is the gate-opener for {56.8}.

## Quality gates

- recall@k table covers all 3 variants × 3 k-values (testStrategy).
- Spike script runs clean (sandbox-disabled); import path verified against installed
  cocoindex.
- `parseTaskListWithWarnings` clean on `task-list.json` after the journal append.
- Liam ratifies one variant in writing BEFORE {56.5} flips done / before {56.8} can
  dispatch.

## Final report

Before `/exit`, write `<events_dir>/final_report.yaml`:

```yaml
summary: <2-3 sentences>
commits: [...]
spike_doc: { path, sha, checker_verdict }
spike_script: { path }
recall_at_k_table: <inline summary or pointer to doc>
recommended_variant: <A | B | C — chunk_size/overlap/min_chunk_size>
liam_ratified: <true|false — false if awaiting parent ratification at exit>
corpus_source: <where the 10-20 docs came from>
OQs_for_parent: [...]
next_session_handoff:
  <1 paragraph; {56.8} chunking-stage dispatch gated on ratified values; {56.6}/{56.7}
  migrations + {56.14}/{56.15} PENDING-NEXT-SESSION>
```

## Out of scope (escalate, do NOT silently expand)

- {56.6} (content_chunks.op_id migration), {56.7} (RPC nullability migration), {56.8}
  (chunking @coco.fn — GATED on this spike's ratified values), {56.9}-{56.13}, {56.16},
  {56.17}.
- {56.14}/{56.15} heading-cols disposition — PENDING-NEXT-SESSION (OQ-CMI-56-4).
- Any edit to `flow.py`, `lib/content/chunking.ts`, or migrations — spike only writes a
  NEW spike script + a NEW research doc.
