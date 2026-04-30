-- S209 OPS-41: refine S207 WP-A4 backfill — assign 'manual' to residual NULLs.
--
-- Spec: docs/specs/ingest-path-consistency-spec.md §8.3 (archived)
-- Carry from: S207 close-out (71/611 = 11.6% NULL post-backfill, exceeds AC3.3-AC2 5% threshold).
-- Continuation prompt: docs/continuation-prompts/continuation-prompt-kh-s209-main-spec-accuracy-review-and-cleanup.md WP3.
--
-- Investigation summary (28/04/2026, S209 WP3, prod project rovrymhhffssilaftdwd):
-- 71 NULL rows distributed across 4 days (22-27/04/2026) — all non-pipeline data:
--   - 22/04: 7 q_a_pair UI batch creates (3 tagged 'doncaster-doc-request-2026-04', 4 untagged)
--   - 25/04: 48 E2E test fixtures ('[E2E-W3/W4/W5]' title prefix, NULL created_by, mixed types)
--   - 26/04: 14 batch_tag='client-value-evidence-2026-04' (case_study + methodology + research)
--   - 27/04: 2 individually-tagged admin notes (prospect-insights / competitive-intelligence)
--
-- None match an automated pipeline (URL, RSS, Python, MCP). All are user-originated
-- via UI Q&A entry, batch upload, manual admin entry, or E2E test seeding. Per
-- S207 spec §3.4 canonical value list, 'manual' is the catch-all for non-pipeline
-- user-originated data, so all 71 map cleanly to 'manual'. No further disambiguation
-- yields material observability gain — these rows predate the typed-provenance
-- column and the originating flows are not actively re-run.
--
-- Idempotent: WHERE ingest_source IS NULL guarantees re-runs are no-ops.
-- Replay-safe on fresh branches: branches start data-empty, so this UPDATE
-- matches no rows on staging until the parent backfill (20260428180945) has
-- replayed against real data.
--
-- AC: post-application, COUNT(*) FROM content_items WHERE ingest_source IS NULL
-- should be 0 (down from 71). Validated post-apply via execute_sql.

UPDATE public.content_items
SET ingest_source = 'manual'
WHERE ingest_source IS NULL;

-- Post-flight verification (run after applying):
--   SELECT COUNT(*) FROM content_items WHERE ingest_source IS NULL;  -- expect 0
--   SELECT ingest_source, COUNT(*) FROM content_items GROUP BY 1 ORDER BY 2 DESC;
