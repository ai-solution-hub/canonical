-- WP-SQUASH-RECON: full post-squash schema reconciliation (S181).
--
-- Closes the remainder of the OLD (rovrymhhffssilaftdwd) → NEW
-- (mgrmucazfiibsomdmndh) drift left after S176 squash and S180 partial
-- reconciliation migrations 20260419094557..095903.
--
-- Diff source: /tmp/claude/old-cols-fresh.txt vs /tmp/claude/new-cols-fresh.txt
-- + /tmp/claude/old-fns-fresh.txt vs /tmp/claude/new-fns-fresh.txt (pooler
-- snapshots taken 19/04/2026 ~13:30).
--
-- Categories addressed:
--   1. ADD COLUMN x6 (5 ingestion_quality_log + 1 read_marks NOT NULL with
--      default). All five new ingestion_quality_log columns are read/written
--      by production code (app/api/quality/route.ts, app/api/review/*.ts,
--      scripts/kb_pipeline/store.py).
--   2. SET NOT NULL x29 (verified zero null rows in NEW for every column;
--      see /tmp/claude/null_check.sql output captured 19/04/2026).
--   3. Function signature gaps: NONE -- get_capture_activity() bare overload
--      replaced by parameterised get_capture_activity(days_back integer
--      DEFAULT 30) which is callable with zero args, so PostgREST callers
--      remain compatible. Documented as intentional.
--   4. Widen pipeline_runs.status CHECK constraint to include
--      'completed_with_errors'. The squash captured the pre-widening
--      state ('running','completed','failed' only); production code in
--      lib/pipeline/record-run.ts:38-41 has emitted 'completed_with_errors'
--      since S152B but writes to OLD have been silently rejected (OLD
--      pipeline_runs row count by status: completed=32, failed=8,
--      running=3, completed_with_errors=0). Surfaced by S181 WP1
--      adversarial verification. Both OLD and NEW need the wider
--      constraint to match the application contract; this migration fixes
--      NEW. OLD will be aligned at cutover via a separate one-shot.
--
-- Categories deliberately NOT addressed (intentional NEW-only state):
--   * varchar -> text type drifts (23 columns). No functional consequence:
--     same TS type (`string`), same PostgREST filter behaviour, no CHECK
--     constraints affected. Modern Postgres convention. Preserved as-is.
--   * `quality_issues_pending` view shape difference. View def in NEW
--     (matches squash baseline 20260416102457) projects {content_item_id,
--     item_title, resolved}; OLD projects {content_title, content_type,
--     platform, source_url} via a different join. Production code does not
--     SELECT from the view at runtime (only `ingestion_quality_log` table
--     is queried; verified via grep across lib/, app/, components/, hooks/,
--     scripts/). View shape is therefore not load-bearing -- preserved as
--     squash-defined.
--   * Extra columns only in NEW (3): pipeline_runs.{items_skipped,
--     items_updated}, user_roles.granted_by. All additive, all benign.
--   * Extra functions only in NEW (3): auto_version_content_history (alias),
--     filter_by_keywords parameterised overload, toggle_star single-arg
--     overload. Additive overloads -- both signatures coexist.

BEGIN;

-- ===========================================================================
-- 1. Missing columns
-- ===========================================================================

-- ingestion_quality_log: 5 missing columns (all nullable, no defaults).
ALTER TABLE public.ingestion_quality_log
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by varchar,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- read_marks: 1 missing column (NOT NULL with default).
ALTER TABLE public.read_marks
  ADD COLUMN IF NOT EXISTS source varchar NOT NULL DEFAULT 'manual';

-- ===========================================================================
-- 2. NOT NULL restores (28 columns)
-- ===========================================================================
-- All verified zero null rows in NEW prior to migration (see
-- /tmp/claude/null_check.sql output captured 19/04/2026 ~13:35).

-- bid_questions
ALTER TABLE public.bid_questions
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN question_sequence SET NOT NULL,
  ALTER COLUMN section_sequence SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

-- content_history (note: title + content already restored in S180
-- 20260419095811; change_type + created_at remained drifted).
ALTER TABLE public.content_history
  ALTER COLUMN change_type SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

-- content_item_workspaces
ALTER TABLE public.content_item_workspaces
  ALTER COLUMN id SET NOT NULL;

-- content_items
ALTER TABLE public.content_items
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN starred SET NOT NULL;

-- ingestion_quality_log
ALTER TABLE public.ingestion_quality_log
  ALTER COLUMN severity SET NOT NULL;

-- pipeline_runs
ALTER TABLE public.pipeline_runs
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

-- processing_queue (note: updated_at already addressed in S180
-- 20260419095200; the others remained drifted).
ALTER TABLE public.processing_queue
  ALTER COLUMN attempts SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN max_attempts SET NOT NULL,
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

-- read_marks
ALTER TABLE public.read_marks
  ALTER COLUMN content_item_id SET NOT NULL,
  ALTER COLUMN read_at SET NOT NULL,
  ALTER COLUMN user_id SET NOT NULL;

-- taxonomy_domains
ALTER TABLE public.taxonomy_domains
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN display_order SET NOT NULL,
  ALTER COLUMN provenance SET NOT NULL;

-- taxonomy_subtopics
ALTER TABLE public.taxonomy_subtopics
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN display_order SET NOT NULL,
  ALTER COLUMN provenance SET NOT NULL;

-- user_roles
ALTER TABLE public.user_roles
  ALTER COLUMN created_at SET NOT NULL;

-- workspaces
ALTER TABLE public.workspaces
  ALTER COLUMN type SET NOT NULL;

-- ===========================================================================
-- 3. CHECK constraint widening
-- ===========================================================================
-- pipeline_runs.status must accept 'completed_with_errors' (emitted by
-- lib/pipeline/record-run.ts). Squash captured the narrow pre-widening
-- CHECK; production writes have been silently rejected against both OLD
-- and NEW. Widen on NEW so cutover writes succeed.
ALTER TABLE public.pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;
ALTER TABLE public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
    CHECK (status = ANY (ARRAY['running', 'completed', 'completed_with_errors', 'failed']));

COMMIT;
