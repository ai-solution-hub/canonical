-- =============================================================================
-- T6 WP1 — q_a_pairs full schema + q_a_extractions + q_a_pair_history + history trigger
-- =============================================================================
--
-- Scope: PLAN.md §4.6 sub-tasks 1-3. Sub-task 4 (q_a_search RPC) is separate WP2
-- migration; sub-task 5 (staging apply) is orchestrator op; sub-task 6 (types regen)
-- is post-apply orchestrator op; sub-task 7 (integration test) is WP3.
--
-- Sources of truth:
--   * docs/specs/canonical-pipeline-implementation-plan/PLAN.md §4.6 (sub-tasks 1-3)
--   * docs/plans/phase-0-investigation/architecture/05-qa-flow.md §2 (column shape)
--   * docs/plans/phase-0-investigation/architecture/05-qa-flow.md §3 (q_a_extractions +
--     history mirror + cocoindex UPSERT target)
--   * docs/plans/phase-0-investigation/architecture/05-qa-flow.md §11 (anti-patterns,
--     notably no idx_q_a_pairs_workspace — RATIFIED-DO-NOT-BUILD)
--   * docs/specs/rls-pattern/PRODUCT.md P-1 (RLS auto-enable) + P-2 (per-role grants) +
--     P-4 (anon REVOKE-EXECUTE on PL/pgSQL functions)
--   * CLAUDE.md Supabase gotchas: anon EXECUTE auto-grant + function search_path
--
-- Enum reconciliation — origin_kind + publication_status CHECK constraints replaced:
--   * origin_kind:        T2 had ('manual','imported_legacy','derived_from_bid_response',
--                         'cocoindex_extracted'). Spec §2.1 / 05-qa-flow.md §2.1 requires
--                         ('extracted_from_corpus','curated_explicit',
--                          'derived_from_bid_response','imported_legacy'). Default was
--                         'manual' -> now 'curated_explicit'. 0 rows so DROP+ADD is safe.
--   * publication_status: T2 had ('draft','published','superseded','archived'). Spec §2.1
--                         requires ('draft','in_review','published','archived') -- UC6 §8.3
--                         revising published Q&A pairs moves to 'in_review' not 'superseded'.
--                         The superseded_by UUID column carries lineage; 'superseded' value
--                         on publication_status was redundant. 0 rows so DROP+ADD is safe.
--
-- Apply discipline:
--   * Staging first: supabase db push (orchestrator op post-cherry-pick)
--   * Liam ratification gate, then prod: supabase db push
--   * CLI in sandbox: dangerouslyDisableSandbox=true + POSTGRES_PASSWORD set
--   * cat supabase/.temp/project-ref before each push (CLAUDE.md project-ref drift gotcha)
--   * supabase gen types typescript after apply (regenerates database.types.ts)
--   * Dependencies: T2 migration 20260520120828_t2_combined_pr_intel_shape_b_form_type_split.sql
--     must have been applied first (creates q_a_pairs base shape)
--
-- Apply log:
--   * (pending staging apply by orchestrator)
--

-- =============================================================================
-- SUB-TASK 1 -- ALTER q_a_pairs to full spec-compliant shape
-- =============================================================================
--
-- Extend the T2 minimal shape. Zero rows in q_a_pairs -- all ALTERs are safe.

-- 1a. Add new columns required by spec §2.1
ALTER TABLE public.q_a_pairs
  ADD COLUMN alternate_question_phrasings text[] NOT NULL DEFAULT '{}',
  ADD COLUMN question_embedding vector(1024) NULL;

-- 1b. answer_standard NOT NULL (spec §2.1 requires NOT NULL; 0 rows so safe)
ALTER TABLE public.q_a_pairs
  ALTER COLUMN answer_standard SET NOT NULL;

-- 1c. Reconcile origin_kind CHECK + DEFAULT
--     T2: CHECK IN ('manual','imported_legacy','derived_from_bid_response','cocoindex_extracted')
--     Spec: CHECK IN ('extracted_from_corpus','curated_explicit','derived_from_bid_response','imported_legacy')
ALTER TABLE public.q_a_pairs
  DROP CONSTRAINT IF EXISTS q_a_pairs_origin_kind_check;

ALTER TABLE public.q_a_pairs
  ADD CONSTRAINT q_a_pairs_origin_kind_check
    CHECK (origin_kind IN (
      'extracted_from_corpus',
      'curated_explicit',
      'derived_from_bid_response',
      'imported_legacy'
    ));

ALTER TABLE public.q_a_pairs
  ALTER COLUMN origin_kind SET DEFAULT 'curated_explicit';

-- 1d. Reconcile publication_status CHECK
--     T2: CHECK IN ('draft','published','superseded','archived')
--     Spec: CHECK IN ('draft','in_review','published','archived')
--     'superseded' removed -- lineage carried by superseded_by UUID column (per §2.1).
ALTER TABLE public.q_a_pairs
  DROP CONSTRAINT IF EXISTS q_a_pairs_publication_status_check;

ALTER TABLE public.q_a_pairs
  ADD CONSTRAINT q_a_pairs_publication_status_check
    CHECK (publication_status IN (
      'draft',
      'in_review',
      'published',
      'archived'
    ));

-- =============================================================================
-- SUB-TASK 2 -- CREATE q_a_extractions derived cache
-- =============================================================================
--
-- Cocoindex UPSERT target -- managed_by='user' per postgres.mount_table_target;
-- DDL ownership is KH, cocoindex performs UPSERTs against it. No special DB
-- constraint for managed_by='user'; that is a cocoindex source-config concern.
-- Per 05-qa-flow.md §3 + §3.2 (extractor_kind enum) + §3.4 (cocoindex flow).

CREATE TABLE public.q_a_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source may be a content_item OR a sidecar markdown (NULL for sidecar-only per §2.3)
  source_content_item_id uuid NULL
    REFERENCES public.content_items(id) ON DELETE SET NULL,
  -- Extractor that produced this row -- enum per §3.2 + S16 §6.3
  extractor_kind text NOT NULL
    CHECK (extractor_kind IN (
      'prior_bid_response',
      'llm_extraction',
      'yaml_frontmatter_v1',
      'markdown_heading_v1'
    )),
  extracted_question_text text NOT NULL,
  extracted_answer_text text NULL,
  extraction_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Lineage to corpus pair -- set when extraction is promoted (UC5 flow per §9)
  promoted_to_pair_id uuid NULL
    REFERENCES public.q_a_pairs(id) ON DELETE SET NULL,
  -- Invalidation audit trail -- set by cocoindex when source content changes (§3.1)
  -- Invalidated rows are NOT deleted; new extraction rows are emitted for new content.
  invalidated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.q_a_extractions ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.q_a_extractions'::regclass);

-- Corpus-level read (mirrors q_a_pairs policy pattern from T2)
CREATE POLICY q_a_extractions_select ON public.q_a_extractions
  FOR SELECT USING (true);

CREATE POLICY q_a_extractions_insert ON public.q_a_extractions
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY q_a_extractions_update ON public.q_a_extractions
  FOR UPDATE USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY q_a_extractions_delete ON public.q_a_extractions
  FOR DELETE USING (auth.role() IN ('authenticated', 'service_role'));

-- =============================================================================
-- SUB-TASK 2 (continued) -- q_a_pair_history version table
-- =============================================================================
--
-- Trigger-written history per §3.3. Version-on-cite substrate for §6.0.3 of
-- 0.9-edit-flow-investigation.md -- shipped bid responses resolve to version
-- snapshot via this table.

CREATE TABLE public.q_a_pair_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  q_a_pair_id uuid NOT NULL
    REFERENCES public.q_a_pairs(id) ON DELETE CASCADE,
  version integer NOT NULL,
  -- Snapshot columns at transition (copy OLD row fields at UPDATE time)
  question_text text NOT NULL,
  alternate_question_phrasings text[] NOT NULL,
  answer_standard text NOT NULL,
  answer_advanced text NULL,
  scope_tag text[] NOT NULL,
  anti_scope_tag text[] NOT NULL,
  origin_kind text NOT NULL,
  publication_status text NOT NULL,
  valid_from timestamptz NULL,
  valid_to timestamptz NULL,
  -- Audit metadata
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (q_a_pair_id, version)
);

ALTER TABLE public.q_a_pair_history ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.q_a_pair_history'::regclass);

-- History table: authenticated read; no direct writes (trigger-only per §3.3)
CREATE POLICY q_a_pair_history_select ON public.q_a_pair_history
  FOR SELECT TO authenticated USING (true);

-- No INSERT / UPDATE / DELETE policies -- rows written exclusively via the history
-- trigger function (SECURITY DEFINER) below.

-- =============================================================================
-- SUB-TASK 2 (continued) -- FUNCTION q_a_pairs_history_trigger
-- =============================================================================
--
-- AFTER UPDATE trigger on q_a_pairs: captures the OLD row snapshot into
-- q_a_pair_history with the next sequential version number.
--
-- * SECURITY DEFINER so the function can INSERT into q_a_pair_history regardless
--   of the calling user's RLS context (no INSERT policy on history table).
-- * SET search_path = public, extensions per CLAUDE.md function search_path rule.
-- * On UPDATE only -- INSERT does not create history rows (spec §3.3).
--   On DELETE the CASCADE FK handles q_a_pair_history rows automatically.
-- * REVOKE EXECUTE FROM anon -- per RLS-PATTERN P-4 + CLAUDE.md anon-EXECUTE gotcha.

CREATE OR REPLACE FUNCTION public.q_a_pairs_history_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
DECLARE
  v_next_version integer;
BEGIN
  -- Only fire on UPDATE (guard belt-and-suspenders; trigger is AFTER UPDATE)
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Compute next sequential version for this q_a_pair_id
  SELECT COALESCE(MAX(version), 0) + 1
    INTO v_next_version
    FROM public.q_a_pair_history
   WHERE q_a_pair_id = OLD.id;

  -- Insert OLD row snapshot into history
  INSERT INTO public.q_a_pair_history (
    q_a_pair_id,
    version,
    question_text,
    alternate_question_phrasings,
    answer_standard,
    answer_advanced,
    scope_tag,
    anti_scope_tag,
    origin_kind,
    publication_status,
    valid_from,
    valid_to,
    changed_at,
    changed_by
  ) VALUES (
    OLD.id,
    v_next_version,
    OLD.question_text,
    OLD.alternate_question_phrasings,
    OLD.answer_standard,
    OLD.answer_advanced,
    OLD.scope_tag,
    OLD.anti_scope_tag,
    OLD.origin_kind,
    OLD.publication_status,
    OLD.valid_from,
    OLD.valid_to,
    now(),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

-- Per RLS-PATTERN P-4 + CLAUDE.md "Supabase auto-grants anon EXECUTE" gotcha:
-- pg_default_acl makes REVOKE ... FROM PUBLIC a no-op against anon.
-- Explicit REVOKE required in the same migration.
REVOKE EXECUTE ON FUNCTION public.q_a_pairs_history_trigger() FROM anon;

-- =============================================================================
-- SUB-TASK 2 (continued) -- TRIGGER q_a_pairs_history_on_update
-- =============================================================================
--
-- AFTER UPDATE on q_a_pairs -- fires for every row UPDATE, capturing the OLD
-- state before the new values are committed.

CREATE TRIGGER q_a_pairs_history_on_update
  AFTER UPDATE ON public.q_a_pairs
  FOR EACH ROW
  EXECUTE FUNCTION public.q_a_pairs_history_trigger();

-- =============================================================================
-- SUB-TASK 3 -- GIN indexes on scope_tag fields
-- =============================================================================
--
-- Workspace-relevance filter substrate per §2.2:
--   WHERE q_a_pairs.scope_tag && workspaces.scope_tag
--     AND NOT (q_a_pairs.anti_scope_tag && workspaces.scope_tag)
--
-- idx_q_a_pairs_workspace (workspace-partition index) is RATIFIED-DO-NOT-BUILD
-- per §11 anti-patterns + PLAN.md §4.6 acceptance criteria. NOT added here.

CREATE INDEX idx_q_a_pairs_scope_tag
  ON public.q_a_pairs USING gin (scope_tag);

CREATE INDEX idx_q_a_pairs_anti_scope_tag
  ON public.q_a_pairs USING gin (anti_scope_tag);
