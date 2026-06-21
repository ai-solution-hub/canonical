# Adversarial verification — APP-2 (procurement drafting loop consolidation)

Verdict: **needs-human** — duplication is real for 2 sites, but the "3 production sites
share the loop" headline + the implied 3-way consolidation is OVERSTATED and not a clean
behavioural equivalence. Scope the extraction to 2 sites; decide separately on draft-stream.

## Liveness (all sites are live — NOT a retire/built-not-wired question)
- `ast-dataflow callers lib/ai/draft.ts:runDraftingPipeline` → 3 prod call sites (exact, direct):
  - `app/api/procurement/[id]/responses/draft/route.ts:203` (fn POST)
  - `lib/queue/handlers/procurement-draft-all.ts:282` (fn runBidDraftAllJob)
  - `app/api/procurement/[id]/responses/[rId]/regenerate/route.ts:121` (fn POST)
  - plus test callers in `__tests__/lib/procurement-drafting.test.ts`, `__tests__/lib/ai/draft.test.ts`.
- Queue handler is wired: `lib/queue/dispatch.ts:84 case 'form_draft_all':` → `runBidDraftAllJob` (L116).
- `draft-all/route.ts` confirmed thin 202-enqueue (maxDuration=30, enqueues form_draft_all). Finding's note accurate.
- gh-security cluster I ("drafting / cost / quality-actions") = `lib/quality/quality-actions.ts`
  + per-question cost helpers + non-streaming `draftResponse`. NONE of the 4 files here are those
  dead symbols. So this is not a keep-cluster reclassify; it is a genuine consolidate question.

## Genuine clone (CONFIRMED equivalent) — 2 sites
jscpd analysis.json crossdir/biggest: `draft/route.ts` L163-215 ↔ `procurement-draft-all.ts`
L243-296 = 53 lines / 215 tokens (+ an 11-line tail L215-225 ↔ L297-307 = 51 tokens).
Inner per-question block is near-verbatim:
  fetch content_items by matched_content_ids (same select+error-throw+map shape)
  → runDraftingPipeline(draftableQuestion, matchedContent, model_tier)
  → upsert form_responses (identical payload: response_text, source_content_ids, metadata,
    review_status:'ai_drafted', drafted_by: PIPELINE_SYSTEM_USER_ID, updated_at, overall_score;
    onConflict 'question_id'; select('id').single())
  → update form_questions status 'ai_drafted'.
Queue handler docstring L6-8 explicitly: "literal extraction from draft-all/route.ts:80-301".
Reconcilable divergences: sb() wrapper vs inline error-handling; draftedResponseIds.push();
new Date(Date.now()) vs new Date(); HTTP-shape vs PermanentJobError. → SAFE to extract for these 2.

## Overstated / NOT equivalent — draft-stream (the claimed 3rd site)
- jscpd raw report: draft-stream shares with draft/route ONLY (a) file-header boilerplate
  (imports/UUID_RE/maxDuration, L18-55 ↔ L15-42) and (b) the 11-line upsert object literal
  (L295-306 ↔ L222-233). It is NOT flagged as a clone of the orchestration loop.
- draft-stream is SINGLE-QUESTION (no loop), uses `draftResponseStreaming` + separate
  `analyseQuestion`/`checkResponseQuality` (NOT runDraftingPipeline), SSE transport.
- draft-stream does extra ID-58 work the other 2 do NOT:
  - reads content_history → citedVersionById (L121-174)
  - writes polymorphic public.citations (delete+insert, one row per distinct matched item, L312-391)
  - emits SSE citation_warning on failure; created_by: user.id on citation rows.
- Folding draft-stream into a shared draftQuestions() core would drop the citations-table /
  version-stamp behaviour OR wrongly push streaming/single-question semantics into the batch path.

## regenerate (4th path) — only shares the pipeline call, not the loop
- Single-question; matched content from existing.source_content_ids (NOT question.matched_content_ids);
  UPDATE-by-id (NOT upsert onConflict); last_edited_by: user.id; threads regenerationInstructions.
- Shares only `runDraftingPipeline(...)` + content-fetch with the loop, not the upsert/status loop.

## Conclusion
- Headline "loop copy-pasted across 3 production sites" is true for 2 (draft/route + queue handler),
  not 3. The recommended `draftQuestions()` extraction is sound and beneficial for those 2.
- The recommendation's framing ("3 callers reduce to validate→load→draftQuestions...; the shared
  part is the LOOP") conflates the 2 genuinely-equivalent loop sites with draft-stream (divergent,
  citations-table-bearing) and regenerate (single-question UPDATE). Not a clean N-way equivalence.
- A "no duplication" stance would be wrong (real 53-line clone exists) → not confirmed-safe-to-ignore,
  but the consolidate-as-specified is not safe-as-written. → needs-human to re-scope to 2 sites and
  decide where the ID-58 citations write lives.
