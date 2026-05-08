# Session: e0ec0499-c078-410f-b1f9-79f847a3c1c7

## Turn 1 — User [Initial Prompt]

I've just used /clear, Claude, as a considerable amount of work was covered over several turns, but by continuing without using clear, the conversation wouldn't have been cached. Instead, I've saved the full output to: /Users/liamj/Documents/development/knowledge-hub/main_session_output.json.                                                

Please review the output in full as it shows our entire session from the point that we began with the continuation prompt. Then, please see below for my feedback based on your last response before I used /clear. Please also review any other documents, as necessary, to ensure you have the full context.                                                                                                                       

Keep in mind that we won't yet have used /update-docs or /handoff yet due to using /clear, but instead, as we are in a fresh session from a token perspective, we can continue with the outstanding work now, and then once those items are complete, we can close out the session as we normally would and prepare for the next one. 

It is critical that we get this right, given where the product currently is in terms of pre-launch status. If anything is unclear please ask before proceeding.

## User General Feedback

- Having reviewed the synthesis I believe more investigation work is required before we finalise the next steps. I can see in principle why `P3 Q&A docx`, `P4 TS URL ingest`, `P5 TS manual creation`, `P9 RSS`, and `P10 MCP` are consider unique entry points but is there a more efficient approach available, which would standardise the ingestion setup? 
    - Are there normalisation opportunities with the various entry point shapes, for example?
    - There shouldn't be any difference in classification and embedding (and chunking) between the python and TS paths. Unless I've misunderstand, there are two top-level types of content - something is either a document (source_file), or a URL (source_url) - even UI or MCP created content can take the form of a "document"
- The investigation covered items where only some paths set a field and others don't, but have we also covered where none of the paths are setting the value? (e.g., for P1-3, content_owner_id, created_by, source_document_id etc.)
- The system has been built up over time, quickly and by lots of different agents - it's our development approach which often leads to architectural decisions being made and often without the full understanding of exactly what's required or what already exists.
    - Three key factors that we should consider: 
        - When the system was originally built, there wasn't a canonical format. There now is, and all content should be converted to markdown. If that's the case, we need to determine whether it's even required to store a document in a storage bucket versus store the markdown in a table which also allows versioning of content.
        - The Python pathways were again originally just because we didn't have another mechanism available and all of the ingestion and classification and embeddings was taking place via my laptop locally using scripts as the UI hadn't been built, but it has now, and we have Cloud Run set up for staging and prod.
            - P1 - what does P1 do (bulk URL ingest)?
            - P2 (Python markdown) - Built early in the platform's development, so that we had a mechanism for ingesting and then testing content. This isn't likely to be used day-to-day by a client. Are there aspects of this that should or could be used for P8 EP2?
            - P7 TS file upload - why couldn't P6 (TS batch creation) & P8 (EP2 markdown batch) be absorbed?
            - `OPS-47 - EP3 markdown ingest UI` is already on the product backlog and 1.11 is on the roadmap/in-flight.
        - As noted earlier, re-ingestion isn't a problem at this stage because we know exactly what files it is we're looking to re-ingest from the client and the subset is small. If we're going to make any architectural changes now is the time to do it.
    - Based on the investigation findings so far, is the Knip config incorrect and hiding failures? If so, we need to update it to prevent further issues.

## Metadata file bag feedback

- To me, this looks like a key example of "built not wired", where some of the fields were already lifted to 'source_documents' and 'feed_articles' tables, but the UI/backend may not have been updated correctly, and the data not migrated.
    - **Track source spec/plan (will be in .planning/.archive/.specs or .plans)**
- What is the intended relationship between a source document and content items, in terms of how the system treats these? E.g., is it that a source document gets ingested and split out into content items?

## Provisional Decision/Question Responses

**Provisional** open question responses - subject to change, based on wider framing from general user feedback section, as are the previous responses I gave to the initial questions:

- Q1. Agreed - always set ingestion-now() on every path; promote source-publication-date to a typed column source_published_at
- Q2. Agreed on deferred status
- NEW1. I would need more info here. Where are we setting expiry date? How is it extracted and used currently? And does this tie in with the item on the roadmap in the first section related to human-in-the-loop metadata?
- NEW2. Should be set on all paths with known semantics.
- NEW3. Drop now.
- NEW4. B - worker-side.
- NEW5, NEW6, and NEW7. I need some guidance here. Whilst we want to ensure we're consistent, I also don't know what the difference is in terms of quality for MD5 versus SHA-256 and therefore which we should be using. In terms of storage path for markdown, what happens currently? My instinct is that the content should be saved to a storage bucket. But again, I don't know what the current backend setup is for any of the documents that get ingested via any of the paths. As quality of data is one of our key differentiators, we should ensure that we have the necessary setup in place for things like re-upload detection. But do we not already have this, or is that only for .docx?
- NEW8. Yes.
- NEW9. Cron only, across all paths.
- NEW10. Yes.
- NEW11. `sb()` + `logBestEffortWarn` - we need to ensure that any issues are surfaced to a user, and tied to the specific content item.
- NEW12. Ideally before re-ingestion, but non-blocking
- NEW13. What would be the best approach here, given that there will be a considerable undertaking of work which will likely lead to changes across reference docs.

## Items to bring forward to pre-re-ingestion (subject to wider re-framing)

- no-multi-write-shared-catch, no-fire-and-forget-supabase-write, cron-catch-must-record-failure, Python ruff B902 ESLint rules
- Fixing all 'supabase-js error not destructured' findings
- Fixing the '0.2.6 — Swallow-catch (~150 catch sites - 8 P1 / 50+ P2)' items
- 'P1 missing FKs (workspaces, processing_queue, digests)' + rename for DB/UI consistency.
- P2 ingestion_quality_log FK ground-truthing
- Q&A docx caller for log_quality_issue helper (Path 6 §2.9)

## From **WILL FIX** section

16. What examples are there of "classifier just wasn't called"?
17. Do we know why the content chunks weren't originally generated for the RSS items, and is the underlying issue now fixed so that future RSS items don't need to be regenerated?
18. As above for batch (P6)

---

## Turn 2 — Assistant

Reading session output + key context first.

Got prior session context. Now reading synthesis + spec history + EP3 backlog item before responding.

Reading more synthesis sections + key spec history before responding.

Now confirming working tree clean before drafting response.

Got enough context. Modified SKILL.md is no-op stat change — leave for now. Drafting response addressing each feedback item.

---

# Session resumption — context loaded, response below

Read prior session output + 0.6 synthesis (lines 1-897) + ingest-path-consistency-spec (S203 RATIFIED — relevant) + extractDates implementation + expiry readers + EP3/OPS-47 backlog + roadmap §1.15. Working tree has one stat-only change on update-docs SKILL.md (no diff content) — ignoring.

Substantive response on each feedback area below. **Drop caveman mode** for this — multi-step architectural framing where fragment order matters; resume on shorter status updates.

---

## 1. Architectural reframing — your strongest point

You're right and the synthesis underweighted this. The synthesis treated 10 paths as a fixed inventory and asked "are they all needed" as a yes/no per-path question (§4.4). The right question is **"is the 10-path inventory itself a historical artefact of the system being built before a canonical pipeline shape existed?"** — and the answer is mostly yes.

**Re-stating your model:**

> Two top-level input shapes: **document** (carries `source_file`) or **URL** (carries `source_url`). Markdown is the canonical text format. Everything else (UI, MCP, cron) is a *transport*, not a *content shape*.

If we accept that, the canonical pipeline is **one** flow, not two:

```
input shape (doc | url)
  → extract to canonical markdown
  → classify (single classifier, single model)
  → embed (single model)
  → chunk (single helper)
  → store (content_items + source_documents row + chunks + entity side-effects)
  → observability (pipeline_runs + telemetry + quality_log uniformly)
```

Where the existing 10 paths fit under this:

| Today's path | Input shape | Transport | Why it exists today | Could collapse into |
|---|---|---|---|---|
| P1 Python URL cron | URL | Cloud Run cron (or local CLI) | Pre-UI bulk URL ingest from operator's laptop | **Cloud Run cron + canonical URL ingest core**. P4 is the same thing with a UI wrapper |
| P2 Python markdown | Document (md) | Local CLI | Pre-UI dev/test seeding | **EP2/EP3 markdown UI** absorbs (your roadmap §1.11 / OPS-47) |
| P3 Q&A docx | Document (docx) | Local CLI | Specialised parser for Pattern A/B tables | **File upload + parser dispatch** (P7-shape with content-type routing) |
| P4 TS URL ingest | URL | API/UI | Single-URL UI variant | Same canonical URL core as P1 |
| P5 TS manual | "URL or file but actually neither" | API/UI form | User typing/pasting | Genuinely distinct — content originates in UI, no extract step |
| P6 TS batch | Document (mixed) | UI autosplit | Autosplit DOCX/markdown | **EP2/EP3** absorbs once autosplit is reshaped |
| P7 TS file upload | Document (binary) | API/UI | Multipart binary; only path with source_documents | Canonical document core |
| P8 EP2 markdown batch | Document (md) | UI queue | Just shipped S226; queue + worker | Canonical document core (markdown sub-shape) |
| P9 RSS | URL (discovered) | Cron poll | Discovery + relevance filter | Genuinely distinct — discovery side-channel + filter; output shape is URL once promoted |
| P10 MCP create | URL or Document | MCP/OAuth | AI-client write surface | Distinct transport; payload could be URL OR file ref |

**Net architectural verdict (preliminary, needs sub-agent verification):**

- **3 truly distinct shapes/transports**: P5 (manual UI typing), P9 (RSS discovery), P10 (MCP — but its payload is URL-or-doc, so it could share the canonical core for that part)
- **2 canonical cores needed**: URL ingest, Document ingest
- **5 of the 10 paths are legacy artefacts** (P1, P2, P3, P6, partial P8 — markdown variant of doc ingest)

Implication: instead of fixing 10 paths' inconsistencies (the OVERSIGHT cluster from §4.2), we **collapse** the legacy paths onto canonical cores. The OVERSIGHT problems (`source_domain`, `platform`, `content_owner_id`, `pipeline_runs`, `quality_score`) disappear because there's only one place to set them.

But this is a **bigger architectural change than the re-ingest gates currently scoped (16-30h).** Doing it pre-launch is the right time per your earlier point ("re-ingestion isn't a problem at this stage"), but I want your direction before scoping.

---

## 2. Direct answers to where I can give them now

### NEW5/6/7 — MD5 vs SHA-256, storage path, current backend setup

**MD5 vs SHA-256 (NEW6):**
- For dedup/integrity (our use case), **MD5 is fine**. Faster, smaller (32 hex chars vs 64), and we're not protecting against adversarial hash-collision attacks.
- The DB already commits to MD5: `content_items.content_text_hash` is `GENERATED ALWAYS AS md5(normalised_text)`. Path 7 stores `content_hash` on `source_documents` using MD5.
- SHA-256 only justified if we'd reuse it for authentication/signing (we won't).
- **Recommend MD5 for content_hash on source_documents (NEW6) — parity with existing pattern.** Confidence high.

**Current storage backend (NEW5/NEW7):**
- Path 7 (binary upload) writes to Storage bucket `documents` (key in `file_path`), then writes `source_documents.storage_path` referencing that key. So we DO have re-upload detection infrastructure for binary files (via `content_hash` on source_documents).
- Markdown today: P8 (EP2) does NOT write to storage — text is held inline in the request payload, written to `content_items.content` only. No `source_documents` row, no bucket object.
- For markdown, three options for `storage_path`:
  - **(a) Nullable** — markdown stays in `content_items.content`; `source_documents` row carries metadata only (filename, hash, mime, size). Smallest change. **Recommend for v1.** Versioning later via `content_history` already wired.
  - **(b) Persist to bucket `markdown`** — full parity with binary; gives us downloadable original. ~2-3h extra work. Worth doing if we want "download original" UX symmetry.
  - **(c) Sentinel** (e.g. `inline:` URI) — clever but anti-pattern.
- Re-upload detection (NEW7): with `source_documents.content_hash` set, the same MD5 lookup we use for binaries works for markdown too. Defer to WP-F per the earlier recommendation, but the **infrastructure is the same**, not a new system.

**Recommendation matrix for D2 v1 (markdown source_documents):**
- `storage_path`: **nullable** for v1 (keeps text in `content_items.content`). Promote to bucket later if needed.
- `content_hash`: **MD5** of normalised markdown text.
- `mime_type`: `text/markdown`.
- `original_filename`: from upload form.
- `extracted_text`: NULL for markdown (the text IS the source; nothing to "extract").

### NEW1 — expiry_date deep dive

**Where set:**
- `app/api/ingest/url/route.ts:250-253` (P4) — calls `extractDates(extracted.content)` from `lib/date-extraction.ts:737` then `findExpiryDate()` to pick the most likely expiry candidate.
- `app/api/upload/route.ts:495-498` (P7) — same helper.
- All other paths: **never written** at ingest. `metadata-sidebar.tsx` allows admin/editor to edit post-ingest.

**How extracted:**
- `lib/date-extraction.ts` — regex-based pattern matcher (recognises "expires…", "valid until…", DD/MM/YYYY etc.). No AI involved.
- `findExpiryDate()` selects the date most contextually-tagged as an expiry/end-date. Heuristic, not validated by AI.

**How used:**
- **`metadata-sidebar.tsx:271-345`** — primary user surface (read + edit).
- **`framework-summary-card.tsx`** + **`certification-summary-card.tsx`** — DIFFERENT field (`entity_mentions.metadata.expiry_date` for certifications, NOT `content_items.expiry_date`). Two-store architecture per memory `project_expiry_date_gap`.
- Probably consumed by freshness/governance crons (need to confirm).

**Roadmap tie-in:**
- **§1.15 Human-validation for auto-extracted metadata** — pending Liam answers to 7 OQs in `docs/research/human-validation-auto-metadata-research.md`. **Yes**, NEW1 ties directly to §1.15. The research doc treats certification expiry as the highest-impact case but content_items.expiry_date is part of the broader scope.

**My recommendation for NEW1:**
- **Keep extractDates wired on P4 + P7 only** for v1 (don't extend extraction to other paths; date extraction is non-trivial and only structured content has reliable signals).
- **Defer the cross-path uniformity decision to §1.15 human-validation work** — that work-package will define how auto-extracted metadata gets validated, and expiry_date will fall under it.
- For re-ingest: the 617 prod rows lose nothing — re-ingesting via P4/P7 fixes their expiry_date too.

### WILL FIX 16/17/18

**16 — "classifier just wasn't called" examples:**
The synthesis was vague here. Concretely, from the 10-path audits:
- **P3 Q&A docx** — uses `keyword_classifier` (no AI), not `classifyContent`. Means primary_domain/subtopic/keywords come from keyword maps. Distinct by design but means the 440 Q&A rows have lower-fidelity classification than AI paths would give them.
- **P5 manual** — `classify` is OPTIONAL in `app/api/items/route.ts` (gated by request body). Default behaviour when admin types in UI: **classify NOT called**. Result: ~71 prod rows MAY have NULL classification fields.
- **P10 MCP create** — gated by `!isDraft`. If MCP call has `publication_status='draft'`, classify never runs.
- **The actual underlying pattern** in WILL FIX 16: it's **not** "classifier wasn't called" but rather **"the path's variant of classify was wired but inferior or skipped"**. Re-ingest doesn't fix this unless we route through the canonical pipeline.

**17 — RSS chunks regen root cause:**
- `lib/intelligence/pipeline.ts` `storeAsContentItem` writes `content_items` + classify, but **does NOT call `regenerateChunks()`** after content is committed.
- All other paths (P4/P5/P7/P8/P10) call `regenerateChunks()` in their post-classify step.
- **Fix:** add 3-line call to `regenerateChunks()` in `storeAsContentItem` post-classify. ~30 min.
- **Future-proof:** the 28 existing RSS rows can be backfilled via `bun run scripts/backfill-chunks.ts`. **Not** something only re-ingest fixes.
- **Underlying issue NOT yet fixed.** Future RSS items will continue to be created without chunks until the wire-up lands.

**18 — Batch (P6) chunks regen root cause:**
- `app/api/items/batch/route.ts` writes `content_items` + classify per item, but **does NOT call `regenerateChunks()`**.
- Same fix pattern. ~30 min.
- **Underlying issue NOT yet fixed.** Future batch ingests will continue without chunks.

Both 17 and 18 should move from WILL FIX to **MUST** — they're not "re-ingest naturally fixes" because the wiring gap means future ingests have the same problem.

---

## 3. Coverage gap you spotted — fields where NO paths set value

You're right, the synthesis enumerated some-set-but-not-others but didn't separately enumerate fields-no-path-sets. Quick sweep from §3.1:

**ALL paths leave NULL on insert (intentional / lifecycle):** archived_at/by, archive_reason, freshness, freshness_checked_at, governance_review_due, governance_review_status, governance_reviewer_id, next_review_date, previous_freshness, previous_quality_score, priority, starred, superseded_by, verified_at/by, review_cadence_days. **All ACTIVE-LIFECYCLE — set at transition events, not ingest.**

**ALL paths leave NULL — actually NEVER-WIRED:**
- 7 telemetry columns (universal gap → Phase D).

**ALL paths leave NULL on insert — DROP-CANDIDATE:**
- `notes`, `parent_id`, `source_bid` (Q3 ratified).

**Some paths leave NULL where they SHOULDN'T (your specific call-out):**
- `content_owner_id` — P1, P2, P3, P9 (service-role). **OVERSIGHT** — should be pipeline-service UUID.
- `created_by` — same set, same fix.
- `source_document_id` — currently P7-only when its catch-arm fires. Should be ALL document-shape paths after D2 + ingest-path-consolidation work.

**Conclusion:** the "fields nobody writes" category is small once you exclude lifecycle. The bigger structural finding from your reframing is that fields like `content_owner_id`/`created_by` SHOULDN'T need per-path wiring — a canonical pipeline core sets them once.

---

## 4. Knip config — investigation needed

Phase 0.3 reviewed knip suppressions. From my notes:
- 21 GENUINE-BUILD-NOT-WIRED + 17 LEGACY-SCAFFOLD findings surfaced
- 9 INTENTIONAL-RE-EXPORT confirmed correct
- BUT: the 0.3 review **classified** items, it didn't audit whether the config update was over-aggressive

You're asking the right question: **"is the knip config now hiding genuine signals?"** I think probably yes for a subset of the 17 LEGACY-SCAFFOLD items — anything classified "legacy scaffold" might actually be "build-not-wired we forgot about". Need a focused re-audit.

**Recommend Phase 0.7.x: knip config validation pass** — re-run knip with all suppressions OFF, classify each finding as:
- TRUE-POSITIVE-FIXED-NOW (action: code change)
- TRUE-POSITIVE-DEFERRED (action: backlog ticket)
- INTENTIONAL-FALSE-POSITIVE (action: keep config suppression, document why)
- DRIFT (action: remove stale suppression)

Output: corrected knip baseline + ticket list.

---

## 5. Metadata file-bag spec history

Your hypothesis: source_documents and feed_articles tables exist because someone lifted file-bag metadata into typed columns, but UI/backend wasn't updated and data wasn't migrated.

**To verify, need to trace through `.planning/.archive/.specs/`:**
- `ingest-path-consistency-spec.md` (S203, RATIFIED) — covers ingest_source/created_by/content_owner_id consistency. Doesn't cover metadata→source_documents lift.
- `feed-articles-content-items-link-spec.md` — covers feed_articles ↔ content_items relationship.
- `ingestion-implementation-spec.md` — older; original ingestion design.
- Need to find the spec that introduced `source_documents` table.

**Recommend Phase 0.7.y: source_documents history trace** — find the spec that added `source_documents` table; verify whether file-bag metadata migration was scoped (and dropped) or never planned.

**Source documents <-> content_items relationship (your specific question):**

From current code reading (Path 7):
- `source_documents` is created **per uploaded file** (1 row per file).
- `content_items` is created **first** (1 row per content unit), then `source_documents` references it via `content_item_id`, AND `content_items.source_document_id` back-references the source_documents row.
- For **single-file ingestion** (most P7 cases): 1 file → 1 source_documents row → 1 content_items row.
- For **autosplit / multi-content files** (P6): theoretically 1 file → 1 source_documents row → N content_items rows. **But P6 doesn't write source_documents at all today**, so this is hypothetical.

**Intended relationship (per archived specs, needs verification):**
- 1 source_documents row per uploaded artefact (file)
- 1+ content_items rows per source_documents row (autosplit produces N)
- bidirectional link: `source_documents.content_item_id` (when 1:1) OR via a junction (when 1:N — does this exist?).

**Open question — does the schema support 1:N source_documents → content_items?** Not certain from current reading. Need to verify.

---

## 6. Provisional decisions — now ratified for planning

| # | Decision | Provisional answer | Treatment |
|---|---|---|---|
| Q1 | captured_date semantics | Always set ingestion-now() + add `source_published_at` typed col | Ratified — proceed |
| Q2 | Pass 2 entity validation | Deferred status confirmed | Ratified — errata only |
| NEW1 | expiry_date strategy | Need more info — see §2 above + tie to §1.15 | **Pending your call after reading §2** |
| NEW2 | platform controlled-vocab | Set on all paths with known semantics | Ratified — proceed |
| NEW3 | metadata.ingestion_source deprecation | Drop now | Ratified |
| NEW4 | D2 placement | B (worker-side) | Ratified |
| NEW5 | D2 storage_path for markdown | Need guidance — see §2 above | **My recommendation: nullable for v1** — confirm? |
| NEW6 | D2 content_hash algo | Need guidance — see §2 above | **My recommendation: MD5** — confirm? |
| NEW7 | Re-upload detection in v1? | Need guidance — see §2 above | **My recommendation: defer to WP-F (infra is same)** — confirm? |
| NEW8 | TS-side ingestion_quality_log | Yes | Ratified |
| NEW9 | quality_score sync vs cron | Cron-only across all paths | Ratified |
| NEW10 | pipeline_runs for RSS | Yes | Ratified |
| NEW11 | Path 7 swallow-catch policy | sb() + logBestEffortWarn, surface to user, tied to content item | Ratified — but need to spec how "tied to specific content item" displays in UI (per-item warnings panel? ingestion_quality_log entry?) |
| NEW12 | ai_call_log timing | Ideally before re-ingest, non-blocking | **Soft-deferred** — Phase D scope |
| NEW13 | Phase 0.4 unpause | Need guidance | **My recommendation: post-Phase 0.7+ when full scope known** — confirm? |

---

## 7. Pre-re-ingest items moved forward (per your list)

Confirmed inclusion in MUST or SHOULD before re-ingest:
- ESLint rules: no-multi-write-shared-catch, no-fire-and-forget-supabase-write, cron-catch-must-record-failure, Python ruff B902 → **MUST** (prevents regression during re-ingest design + helps the audit work)
- supabase-js error not destructured findings → **MUST** (system-wide fix)
- 0.2.6 swallow-catch (~150 sites — 8 P1 / 50+ P2) → **MUST** for the 8 P1; **SHOULD** for the P2 batch
- P1 missing FKs (workspaces, processing_queue, digests) + UI rename for consistency → **MUST**
- P2 ingestion_quality_log FK ground-truthing → **SHOULD**
- Q&A docx caller for log_quality_issue helper → **SHOULD**

Total revised effort: **~22-26h MUST + ~14h SHOULD ≈ 36-40h** (vs. prior 26-30h, before reframing).

If we accept the canonical-pipeline reframing in §1, this could **decrease** because OVERSIGHT-uniformity work becomes "wire helper once at canonical core" instead of N call-sites.

---

## 8. Proposed Phase 0.7 — architecture investigation (new phase)

Five focused investigations, mostly read-only sub-agents. Estimated 4-5h wall clock.

| Sub | Question | Effort | Sequence |
|---|---|---|---|
| 0.7.1 | **Path normalisation feasibility** — is 10→5 path collapse architecturally sound? Map each path's true distinct value vs duplication. Output: collapse map + blockers list. | ~1h | parallel |
| 0.7.2 | **Python paths obsolescence** — given Cloud Run + UI exist, can P1, P2, P3 retire? P3 needs the docx parser preserved (becomes parser dispatch in P7-shape). | ~1h | parallel |
| 0.7.3 | **P6/P8 absorption into P7-shape** — autosplit reshape; markdown variant of doc ingest. Output: scope + risk for collapsing. | ~30 min | parallel |
| 0.7.4 | **source_documents history trace + intended relationship** — `.planning/.archive/.specs` audit. Confirm 1:N relationship intent. Confirm metadata file-bag migration was scoped/dropped/never-planned. | ~1h | parallel |
| 0.7.5 | **Knip config validation** — re-run with suppressions OFF; classify each finding TRUE-POSITIVE-FIX/DEFERRED/INTENTIONAL/DRIFT. Output: corrected baseline + ticket list. | ~1h | parallel |

After 0.7 returns: **Phase 0.8 — re-plan re-ingest gates with canonical-pipeline option** vs **incremental-fix option** (your call between architectural rework now or wiring fixes only).

---

## 9. Specific questions for you before I dispatch

I want to confirm scope before kicking off agents. Three groups:

### Group A — confirm provisional answers I gave myself

A1. **NEW5 storage_path = nullable for v1 markdown** — confirm? (Alternative: storage to `markdown` bucket adds 2-3h, gives "download original" parity.)

A2. **NEW6 content_hash = MD5 (parity with existing)** — confirm?

A3. **NEW7 re-upload detection = defer to WP-F** — confirm? (Infrastructure already there via source_documents.content_hash; WP-F just adds the check at ingest time.)

A4. **NEW13 Phase 0.4 unpause = post-Phase 0.7+** — confirm? (Drift banners stay in place until full scope of changes is known so we don't rewrite docs twice.)

### Group B — architectural framing

B1. **Canonical pipeline reframing** — proceed with Phase 0.7 to evaluate feasibility, OR stop and stick with incremental-fix-the-10-paths approach? (Phase 0.7 is read-only; doesn't commit to anything.)

B2. **WILL FIX 17/18 promotion to MUST** — agree these aren't really "WILL FIX" because the wiring gap means future ingests inherit the bug? Add to MUST list?

B3. **Path 7 swallow-catch UI surfacing (NEW11 follow-up)** — when an ingestion has a problem ("source_documents insert failed but content_items succeeded"), how should the user see it?
- (i) `ingestion_quality_log` entry tied to content_item_id, surfaced in the item's metadata sidebar as a warning chip
- (ii) Per-item warnings panel (new UX surface)
- (iii) Toast notification on completion + persistent flag on item

### Group C — any clarifications you want from me

C1. Anything in §1 reframing that's unclear or that I've got wrong?

C2. Should I commit the prior session's untracked stat-only `.claude/skills/update-docs/SKILL.md` change first (it might have been from a prior /update-docs invocation), or leave alone?

---

**No agents dispatched yet — awaiting your direction on Groups A/B/C.** Then I'll dispatch Phase 0.7 agents in parallel and report findings.

---

## Turn 3 — User

Thanks Claude.

- Agreed on Proposed Phase 0.7.

Group A:
- NEW6 - Agreed on MD5.
- Agreed - NEW13 Phase 0.4 unpause = post-Phase 0.7+ (no rush for this item at this stage)
- For NEW5/NEW7 - If all content is ingested and then converted to markdown, is there still value to saving the source file versus saving the extracted markdown to a column? And then, if a user wants to download that content as a markdown.docx, etc., file. This is something we already have in place for another of our systems, which would actually be quite straightforward. Is most of this already in place from a database perspective with the content history schema? Or should it be instead that we have a source documents history table? I'm still interested in the dynamic between content items and source documents. So the investigation into these will be beneficial and will likely help drive the answer to this question. 

Group B:
- Agreed that Canonical pipeline is the right way forward for the platform, and will remove considerable duplication and complexity.
- WILL FIX 16, 17, 18: 
    - Noted, canonical pipeline is the path forward, and promoting items from WILL to MUST.
    - The platform also already includes a UI (on the item page) for classifying content - we'll need to check how this is currently wired.
    - This is likely just my lack of understanding from a technical perspective, but why is it that we 'regenerate' chunks rather than 'generate' chunks? Or is the terminology irrelevant here?
- B3. The answer is either (i) or (ii), but again, Understanding the current dynamic between the two types, as well as then deciding what the right approach is, will help us determine the UI. 

Group C:
- All makes sense so far. Also to note, agreed, MCP should share canonical core.
- Yes please, the change to the file was me. I'm also going to use our python script that extracts the main session output to a file in the same way that you reviewed at the start of this session, as you've outlined a considerable amount of valuable context that I don't want us to lose as we move into a new session after the work we complete in this session. Would it make sense for the output to be saved as JSON or Markdown, as I can create either with our script, and the content can be saved with the other investigation work.

---

## Turn 4 — Assistant

Good — answers ratified. Quick checks then dispatching.

SKILL.md diff is 0 lines — stat-only, nothing to commit. Will `git checkout` to clean.

## Quick answers to your questions

**JSON vs Markdown for session output:** **Markdown.** Investigation context gets read by humans (you, future agents reading specs/notes) more than parsed programmatically. Easier to integrate with the other `docs/plans/phase-0-investigation/` files, easier to grep, links naturally to other docs. JSON only wins if we'd build tooling around it (we won't).

**Regenerate vs generate chunks (terminology):** Function uses DELETE+INSERT idempotent pattern — wipes existing chunks for the item, recomputes, inserts fresh. Naming reflects the *pattern* not the call count. First-time run: DELETE is no-op, behaves like generate. Subsequent runs: actual regeneration. Naming is fine — communicates "safe to run anytime" which is the contract that matters. Not worth changing.

**Classification UI on item page:** Good catch — folding into Phase 0.7 as new sub-task **0.7.6**. Need to map what UI exists, what it calls (classifyContent or its own path), how it interacts with the canonical pipeline. If wired correctly it becomes the "manual override" entry point under canonical core; if wired wrong it's another oversight.

**Phase 0.7.4 brief expansion** to include your deeper question:
- Original intent of source_documents (spec history)
- 1:1 vs 1:N source_documents → content_items
- File-bag-to-source_documents migration scoped/dropped/never-planned
- **NEW:** If all content becomes canonical markdown, do we need bucket storage for markdown-only inputs, or does extracted_text + content_items.content cover it?
- **NEW:** Does content_history (versions content_items.content) cover source_documents lifecycle versioning, OR do we need source_documents_history table parallel to it?
- **NEW:** Re-upload-with-edits flow — what happens today and what should happen?

Setting up tasks then dispatching.

Tree clean. Dispatching 6 parallel agents now. Each writes own file + commits.

5 of 6 returned. 0.7.2 hit socket error. Checking state + recovering.

0.7.1, 0.7.3, 0.7.4, 0.7.5, 0.7.6 committed cleanly. 0.7.2 socket-died with no file written — redispatching fresh.

All 6 outputs in. Reading them now to synthesise canonical pipeline plan myself.

All 6 outputs read. Writing Phase 0.7 synthesis now.

Committing synthesis + delivering conversational summary.

# Phase 0.7 complete — 7 documents committed

`docs/plans/phase-0-investigation/0.7-synthesis.md` is the master output (400 lines). Below is the high-level summary; the synthesis doc has full detail.

---

## What changed in our understanding

**Three findings reshape the 0.6 plan materially:**

### 1. `source_documents` was NOT a half-finished file-bag lift

The table was deliberately designed in `content-lifecycle-spec.md` (20 March 2026) as a first-class lineage primitive with versioning baked in (`version` + self-FK `parent_id` + `content_hash` + `archived_at`). The "0/617 prod rows" gap is **operational** (P0-1 silent-fail in P7), not architectural. We don't need to redesign — we need to fix the silent-fail and close the EP2 gap (D2). 

**Relationship is 1:N** (one source_documents → many content_items). Confirmed via qa-autosplit-spec R18-R20 and absence of `content_item_id` column on source_documents.

### 2. The biggest UX friction is "re-upload always creates a NEW content_items row"

Today, every re-upload (even with edits) spawns a fresh content_items row with no link to the prior. The user's mental model — "I edited my doc, see v2 in KB" — is broken. Today the user must manually wire the new item to replace the old via diff-review.

**The canonical-pipeline reframe is what unlocks the fix:** re-upload UPDATEs the existing content_items row (creating content_history v2) while source_documents version-chain captures binary lineage in parallel.

### 3. Two parent-session assumptions invalidated

- **There is NO per-item Classify button on the item detail page.** Only working classify-from-UI is the bulk Re-classify toolbar on `/library`. A "Re-classify after save" toggle is **declared in `ContentTabsEditConfig` but never wired** — `useItemDetailData.tabEditConfig` omits the setter. The PATCH route accepts a `reclassify` body field but only writes a string to a warnings envelope that's discarded. Classic build-not-wired.
- **`detectQAPairs()` has zero production callers.** P6's `pipeline_name='qa_autosplit'` is misleading — Q&A pairs arrive at the route already-formed via paste-from-spreadsheet UI.

---

## Architectural recommendation

10 paths reduce to **5 distinct kernels + 1 canonical pipeline core** under a unified `IngestRequest` envelope:

```
Layer 1: 5 transports (cron / API / MCP / CLI / queued worker)
Layer 2: input-shape router
Layer 3: 5 shape adapters (URL / binary / text / qa-docx / rss-discovery)
Layer 4: ONE canonical pipeline core
         (dedup → side-channel writes → INSERT → classify → embed → chunk
          → post-stages → pipeline_runs → ingestion_quality_log)
```

**3 paths retire** (P1→P4, P2→P8, P6→P8). **5 paths refactor** as canonical-core implementations (P4 URL, P5 manual, P7 binary, P8 markdown-batch, P10 MCP). **2 paths stay specialised** (P3 Q&A docx, P9 RSS).

The canonical core is the chokepoint where `source_domain`, `platform`, `content_owner_id`, `summary_data`, `thumbnail_url`, `pipeline_runs`, `ingestion_quality_log`, AI telemetry happen **once** — not 10 times. The OVERSIGHT-uniformity work disappears by construction.

---

## Effort + sequencing

**Stream 1 — re-ingest readiness gates** (regardless of canonical decision): **~22-28h**
- Same as 0.6 §10 plus 4 knip TRUE-POSITIVE-FIX-NOW items + RSS/batch chunks regen wiring (promoted from WILL FIX) + NEW8 ingestion_quality_log helper + NEW11 swallow-catch surfacing spec.

**Stream 2 — canonical pipeline collapse** (only if A1 ratified): **~9-12 weeks** (~330-470h)
- Phase A foundation (~2 weeks) blocks everything; Phases B-G run in parallel after A.

**Recommended sequencing: re-ingest at end of Stream 1, NOT after Stream 2.** Re-ingesting after canonical foundation compounds risk; better to re-ingest with existing-shape rows clean, then canonical-collapse migrates rows in place.

---

## 13 open questions for you (consolidated)

**Group A — canonical-pipeline architectural commitment:**

- **A1** — Ratify canonical-pipeline collapse as v1 target? Phased plan, ~9-12 weeks pre-launch on top of Stream 1.
- **A2** — If A1=yes: re-upload UPDATEs existing content_items (content_history v2) vs creates new? *(biggest UX unlock)*

**Group B — Stream 1 ratifications:**

- **B1** — P3.B keyword_classifier vs AI classify for 440 prod Q&A rows? *(Recommend AI with 50-row eval gate.)*
- **B2** — NEW1 expiry_date: keep extractDates on P4+P7 only; defer cross-path to roadmap §1.15? Or wire all paths now?
- **B3** — 0.7.4-Q1 identical-re-upload `parent_id`: chain to existing or NULL? *(Recommend chain.)*
- **B4** — Python Q&A 387-row backfill from `source_file` text in Stream 1, or defer until binaries available?
- **B5** — `?format=markdown|docx` export route in Stream 1 (3-5h) or defer? *(`bid-export-docx.ts` already does it; just needs extraction.)*
- **B6** — Per-item Re-classify button on item-detail (~1h) in Stream 1 or Stream 2?

**Group C — operational / cross-track:**

- **C1** — production-readiness Cloud Run scheduler timing? *(P1 retirement blocked.)*
- **C2** — EP8 ship priority? *(P3 retirement blocked; ~16-19h on roadmap §1.11.)*
- **C3** — Knip baseline reduction — apply 0.7.5 §6 (4 fixes + 25 @public migrations) in Stream 1 or defer?

---

## Specific 0.7.x findings worth highlighting

**0.7.1 Path normalisation (87%)** — refined hypothesis: 5 shape adapters + 5 transport overlays. Q&A and RSS stay as specialised kernels. P3 alone covers 71% of prod data → cannot risk regression-via-collapse; defer P3 to Phase F.

**0.7.2 Python obsolescence (88%)** — TS port of Q&A docx extractor already exists (`lib/bid-library-ingest/extract-qa-pairs.ts`) with parity tests. The heavy preservation work (extractors, dedup, classify, embed, chunk) is already TS-canonical or has TS ports. Per-path retire timelines: P2 ~2 weeks, P1 ~3 weeks (blocked on Cloud Run scheduler), P3 ~5-7 weeks (via EP8).

**0.7.3 P6/P8 absorption (78%)** — P8 is already 80% canonical. Recommended sequencing: D1 → D2 → generalise P8 → absorb P6 → absorb P7. The reshape of P6 finally wires the orphan `detectQAPairs()` function. ~6 sessions total.

**0.7.4 source_documents (85%)** — biggest synthesis output (866 lines). Confirms: bucket-only-for-binaries in v1; `markdown` bucket in v2; no separate `source_documents_history` needed (`parent_id` chain IS history); `?format=markdown|docx` reuses `bid-export-docx.ts` (~3-5h). 387 Q&A rows have NULL `source_document_id` (Python pipeline doesn't write source_documents either — D2b gap).

**0.7.5 Knip validation (88%)** — config is "mildly over-aggressive". 4 fix-now items: G-6 batch-reclassify test drift, D-8 untyped admin response, D-9/D-10 orphan VALID_SORT_* consts. Proposed action: migrate 9 queue-handler types and 16 shadcn re-exports to @public; reduce baseline from `41/15/3` to `4/4/1`. 3 of 11 DRIFT items would self-resolve under canonical-pipeline.

**0.7.6 Classification UI (90%)** — corrects parent assumption. NO per-item Classify button exists. Three forked classify implementations (canonical, queue handler, CLI) — Phase 0.7 should fold to single chokepoint `runClassifyForItem`. Recommended fix: add per-item Re-classify button (~1h) + drop dead `reclassifyAfterSave` toggle.

---

## Next step

Awaiting your ratification on Groups A/B/C. Group A is the architectural commitment (yes/no canonical collapse). Group B answers shape Stream 1. Group C tracks cross-track dependencies.

Once ratified: I'll draft the **Phase 0.X re-ingest plan** as a final document (incorporates all decisions; concrete work-package list with effort + sequence). Then we can use `/update-docs` and `/handoff` to close out cleanly.

---

## Session Summary

- **User turns:** 2
- **Assistant turns:** 2
- **Total content:** 41,258 chars, 10,150 tokens

### Files Read

- `/Users/liamj/Documents/development/knowledge-hub/main_session_output.json`
- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.6-synthesis.md`
- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.7.1-path-normalisation-feasibility.md`
- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.7.2-python-paths-obsolescence.md`
- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.7.3-p6-p8-absorption.md`
- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.7.4-source-documents-history-relationship.md`
- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.7.5-knip-config-validation.md`
- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.7.6-classification-ui-wiring.md`

### Files Written

- `/Users/liamj/Documents/development/knowledge-hub/docs/plans/phase-0-investigation/0.7-synthesis.md`
