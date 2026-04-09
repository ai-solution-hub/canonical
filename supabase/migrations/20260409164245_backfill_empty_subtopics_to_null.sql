-- Backfill: coerce literal empty-string subtopics to NULL.
--
-- Context: S158 WP2 ESM classification backfill processed 28 items with
-- 0 failures, but post-run verification found two rows (1003601a... and
-- 93ff55ae...) with `primary_subtopic = ''` (literal empty string) instead
-- of NULL or a valid slug. Root cause: the Claude tool JSON schema for
-- classifyContent declares primary_subtopic as a required string with no
-- minLength, so the classifier emitted `""` to satisfy the required-string
-- contract when it could not confidently choose a subtopic. The DB column
-- is nullable and accepts empty strings silently.
--
-- S159 WP4a tightened `lib/ai/classify.ts` to coerce empty / whitespace-only
-- subtopic values to NULL before writing to the DB. This migration backfills
-- any rows that were already written with empty strings under the old code
-- path. Uses the `= ''` predicate rather than hard-coded item ids so any
-- in-flight writes that land between code merge and migration application
-- are also cleaned up.
--
-- Scope as measured 09/04/2026: 2 rows for primary_subtopic, 0 rows for
-- secondary_subtopic. The UPDATE is safe to re-run (idempotent) and has
-- no cascading effects — downstream filters / guides / relevance scoring
-- already treat NULL as "no value".
--
-- References:
--   docs/specs/classifycontent-subtopic-contract-spec.md
--   docs/audits/si-classification-verification-s156.md § Run 2
--   docs/reference/post-mvp-roadmap.md §2.1.11

UPDATE content_items
SET primary_subtopic = NULL
WHERE primary_subtopic = '';

UPDATE content_items
SET secondary_subtopic = NULL
WHERE secondary_subtopic = '';
