-- =============================================================================
-- ID-104.6 — eval-engine substrate: M1→M4 (concern-grouped, dependency-ordered)
-- =============================================================================
-- Source of truth: specs/id-104-eval-engine/TECH.md §Migration plan (M1–M4) +
--   PLAN.md {104.6}. Column unions mirror lib/eval/contract.ts (the canonical
--   AgentEvalContract + OutcomeSignal — ID-104.5, S356-frozen).
--
-- Four new tables, one migration, grouped by concern and ordered so every FK
-- follows its referent:
--   M1  eval_touchpoints      registry-of-record (T3/T5/T23, B-INV-3)
--   M2  eval_runs             uniform run results (T9/T10/T13)        FK → M1
--   M3  eval_baselines        DB-backed baseline (T11, B-INV-11)      FK → M1
--       eval_baseline_audit   baseline lifecycle (T12, B-INV-12)      FK → M1
--   M4  ai_call_events        recordAiCall() cost + signal (T14/T15/T17, B-INV-15) FK → M1
--
-- RLS is role-based via public.get_user_role() (CLAUDE.md / supabase/CLAUDE.md).
-- The rls_auto_enable() event trigger auto-enables RLS on CREATE TABLE; the
-- explicit ENABLE here is idempotent + self-documenting.
-- grant_standard_public_table_access() applies the standard 3-role grants
-- (incl. anon SELECT); for these admin/tenant-gated tables we then explicitly
-- REVOKE the anon SELECT so anon holds no table privilege at all — RLS already
-- gates anon to zero rows, the REVOKE removes the privilege entirely
-- (mirrors the question_matches / citations precedent).
--
-- NO public.*() SECURITY DEFINER function is introduced (the engine reads/writes
-- via per-user sb() clients), so no REVOKE EXECUTE … FROM anon grants are
-- required here. Any future registry/rollup RPC MUST carry
-- SET search_path = public, extensions + an explicit REVOKE … FROM anon.
--
-- file_sha256 is present-but-NULLABLE on M1 (TECH OQ-1 default): git-backed
-- touchpoints (skills/prompts) populate it for drift detection; non-git
-- touchpoints leave it NULL.

-- -----------------------------------------------------------------------------
-- M4 prerequisite: outcome_signal enum — the RATIFIED four, extensible by a
-- future `ALTER TYPE public.outcome_signal ADD VALUE …`. Created idempotently so
-- replay does not error if the type already exists.
-- (Mirrors lib/eval/contract.ts `OutcomeSignal = 'win' | 'fail' | 'loop' | 'refusal'`.)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'outcome_signal' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.outcome_signal AS ENUM ('win', 'fail', 'loop', 'refusal');
  END IF;
END
$$;

COMMENT ON TYPE public.outcome_signal IS
  'ID-104 T14 — ratified recordAiCall() outcome signal (win|fail|loop|refusal). '
  'Mirrors OutcomeSignal in lib/eval/contract.ts. Extensible via ALTER TYPE … ADD VALUE.';

-- =============================================================================
-- M1 — eval_touchpoints: registry-of-record (T3 / B-INV-3)
-- =============================================================================
-- One row per AI touchpoint. touchpoint_id is the natural PK (stable slug:
-- tool name | prompt name | skill | recipe slug) — its uniqueness IS the
-- duplicate-rejection B-INV-3 requires (a second INSERT of the same id errors).
-- Column unions mirror lib/eval/contract.ts: kind=TouchpointKind,
-- grounding_shape=GroundingShape, severity_on_fail=SeverityTier. Stored as text
-- + CHECK (not pg enums) so a contract addition is a one-line CHECK edit, not an
-- ALTER TYPE — matching the contract's "extensible without breaking" intent.
CREATE TABLE public.eval_touchpoints (
  touchpoint_id     text        PRIMARY KEY,

  kind              text        NOT NULL
                                CHECK (kind IN ('tool', 'prompt', 'skill', 'inline', 'agent_recipe')),
  owner             text        NOT NULL,
  suite_name        text        NOT NULL,
  grounding_shape   text        NOT NULL
                                CHECK (grounding_shape IN ('structured_output', 'forced_tool_strict', 'citations', 'n/a')),
  severity_on_fail  text        NOT NULL
                                CHECK (severity_on_fail IN ('block', 'warn', 'info', 'infra')),
  -- Per-touchpoint regression tolerance (contract default 0.02). NOT NULL bounded [0,1].
  variance_band     numeric     NOT NULL DEFAULT 0.02
                                CHECK (variance_band >= 0 AND variance_band <= 1),
  -- B-INV-19 in-house WS-5 auto-apply metric (optional, contract-addressable).
  graduation_metric text,
  -- B-INV-1/5: contract + registry version advance together on a contract change.
  contract_version  integer     NOT NULL DEFAULT 1,
  registry_version  integer     NOT NULL DEFAULT 1,
  -- TECH OQ-1: present-but-nullable; populated for git-backed touchpoints only.
  file_sha256       text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.eval_touchpoints OWNER TO postgres;

COMMENT ON TABLE public.eval_touchpoints IS
  'ID-104 T3 — registry-of-record for every AI touchpoint. touchpoint_id PK enforces '
  'B-INV-3 (duplicate id rejected). Column unions mirror lib/eval/contract.ts '
  '(AgentEvalContract). file_sha256 nullable (TECH OQ-1) — git-backed touchpoints only. '
  'Admin read/write via get_user_role().';

-- RLS: admin read + write (registry curation is an admin-only act).
ALTER TABLE public.eval_touchpoints ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.eval_touchpoints'::regclass);
REVOKE SELECT ON TABLE public.eval_touchpoints FROM anon;

CREATE POLICY eval_touchpoints_select_admin ON public.eval_touchpoints
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');
CREATE POLICY eval_touchpoints_insert_admin ON public.eval_touchpoints
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY eval_touchpoints_update_admin ON public.eval_touchpoints
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY eval_touchpoints_delete_admin ON public.eval_touchpoints
  FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

-- =============================================================================
-- M2 — eval_runs: uniform run results (T9/T10/T13) — FK → M1
-- =============================================================================
-- One row per eval-runner execution of a touchpoint. metrics is the per-suite
-- measurement bag (jsonb). severity_disposition records how severity_on_fail
-- resolved at run time; exit_class is the runner's 0/1/2 class (B-INV-9/10).
CREATE TABLE public.eval_runs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  touchpoint_id         text        NOT NULL
                                    REFERENCES public.eval_touchpoints(touchpoint_id) ON DELETE CASCADE,

  metrics               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  passed                boolean     NOT NULL,
  -- How the touchpoint's severity_on_fail resolved at run time (block|warn|info|infra).
  severity_disposition  text        NOT NULL
                                    CHECK (severity_disposition IN ('block', 'warn', 'info', 'infra')),
  -- Runner exit class — B-INV-9/10 deterministic 0/1/2 mapping.
  exit_class            smallint    NOT NULL
                                    CHECK (exit_class IN (0, 1, 2)),
  run_at                timestamptz NOT NULL DEFAULT now(),
  -- Lane that produced the run.
  source                text        NOT NULL
                                    CHECK (source IN ('nightly', 'ci', 'manual'))
);

ALTER TABLE public.eval_runs OWNER TO postgres;

-- Load-bearing access path: latest runs for a touchpoint, newest first
-- (/admin/refinement timeline + baseline-compare reads).
CREATE INDEX idx_eval_runs_touchpoint_run_at
  ON public.eval_runs (touchpoint_id, run_at DESC);

COMMENT ON TABLE public.eval_runs IS
  'ID-104 T9 — uniform eval-runner result per touchpoint execution. exit_class is the '
  'runner 0/1/2 class (B-INV-9/10); source = nightly|ci|manual. FK → eval_touchpoints. '
  'Admin read; writer = service/runner role.';

-- RLS: admin read; the runner writes via the service_role key (bypasses RLS by
-- Supabase default), so NO authenticated INSERT policy is granted — writes are
-- service-only. anon holds no privilege.
ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.eval_runs'::regclass);
REVOKE SELECT ON TABLE public.eval_runs FROM anon;

CREATE POLICY eval_runs_select_admin ON public.eval_runs
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

-- =============================================================================
-- M3 — eval_baselines + eval_baseline_audit: DB-backed baseline + lifecycle
--      (T11/T12, B-INV-11/12) — FK → M1
-- =============================================================================
-- eval_baselines: the current promoted baseline per touchpoint (metrics +
-- thresholds the regression check compares against). baselineHistory reads prior
-- rows ordered by promoted_at; the latest is the active baseline.
CREATE TABLE public.eval_baselines (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  touchpoint_id     text        NOT NULL
                                REFERENCES public.eval_touchpoints(touchpoint_id) ON DELETE CASCADE,

  metrics           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  thresholds        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  registry_version  integer     NOT NULL,
  promoted_by       text        NOT NULL,
  promoted_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.eval_baselines OWNER TO postgres;

-- baselineHistory / active-baseline resolution: newest baseline per touchpoint.
CREATE INDEX idx_eval_baselines_touchpoint_promoted_at
  ON public.eval_baselines (touchpoint_id, promoted_at DESC);

COMMENT ON TABLE public.eval_baselines IS
  'ID-104 T11 — DB-backed per-touchpoint eval baseline (metrics + thresholds), '
  'replacing the legacy flat-JSON store (B-INV-11). Latest promoted_at row = active '
  'baseline; prior rows = baselineHistory. FK → eval_touchpoints. Admin read; '
  'promote = admin write.';

-- eval_baseline_audit: append-only who/when/which-version log of baseline
-- lifecycle actions (T12 / B-INV-12). promoteBaseline writes one row per action.
CREATE TABLE public.eval_baseline_audit (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  touchpoint_id     text        NOT NULL
                                REFERENCES public.eval_touchpoints(touchpoint_id) ON DELETE CASCADE,

  action            text        NOT NULL,
  actor             text        NOT NULL,
  registry_version  integer     NOT NULL,
  at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.eval_baseline_audit OWNER TO postgres;

CREATE INDEX idx_eval_baseline_audit_touchpoint_at
  ON public.eval_baseline_audit (touchpoint_id, at DESC);

COMMENT ON TABLE public.eval_baseline_audit IS
  'ID-104 T12 — append-only baseline lifecycle audit (who/when/which registry_version). '
  'One row per promoteBaseline action (B-INV-12). FK → eval_touchpoints. Admin read; '
  'admin write.';

-- RLS for eval_baselines: admin read; promote = admin write.
ALTER TABLE public.eval_baselines ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.eval_baselines'::regclass);
REVOKE SELECT ON TABLE public.eval_baselines FROM anon;

CREATE POLICY eval_baselines_select_admin ON public.eval_baselines
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');
CREATE POLICY eval_baselines_insert_admin ON public.eval_baselines
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');

-- RLS for eval_baseline_audit: admin read; admin write (append-only — INSERT
-- only, no UPDATE/DELETE policy so audit rows are immutable to the request path).
ALTER TABLE public.eval_baseline_audit ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.eval_baseline_audit'::regclass);
REVOKE SELECT ON TABLE public.eval_baseline_audit FROM anon;

CREATE POLICY eval_baseline_audit_select_admin ON public.eval_baseline_audit
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');
CREATE POLICY eval_baseline_audit_insert_admin ON public.eval_baseline_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');

-- =============================================================================
-- M4 — ai_call_events: recordAiCall() cost + signal (T14/T15/T17, B-INV-15)
--      — FK → M1
-- =============================================================================
-- Per-AI-call persisted substrate. outcome_signal uses the ratified enum.
-- Cost fields capture token + cache usage and the derived cost_usd. NEVER
-- egresses off-platform (B-INV-15): rows are read only by on-platform admin
-- surfaces (cost-tab rollup T17) — there is no off-platform writer or reader.
CREATE TABLE public.ai_call_events (
  id              uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),

  touchpoint_id   text                   NOT NULL
                                         REFERENCES public.eval_touchpoints(touchpoint_id) ON DELETE CASCADE,

  model           text                   NOT NULL,
  tier            text                   NOT NULL,
  input_tokens    integer                NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens   integer                NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  -- Prompt-cache accounting (Anthropic cache read/write token counts).
  cache_read_tokens   integer            NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens  integer            NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  -- Derived cost for the call (estimateCost path, T14). numeric for exact money.
  cost_usd        numeric(12,6)          NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  outcome_signal  public.outcome_signal  NOT NULL,
  created_at      timestamptz            NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_call_events OWNER TO postgres;

-- Cost-tab rollup (T17) aggregates per touchpoint over time; nightly/CI reads
-- scan by created_at. Composite index serves both the per-touchpoint rollup and
-- the time-ordered scan.
CREATE INDEX idx_ai_call_events_touchpoint_created_at
  ON public.ai_call_events (touchpoint_id, created_at DESC);

COMMENT ON TABLE public.ai_call_events IS
  'ID-104 T15 — persisted per-AI-call cost + outcome_signal substrate (recordAiCall, T14). '
  'outcome_signal = ratified enum win|fail|loop|refusal. Feeds the cost-tab rollup (T17). '
  'Tenant-safe + admin read; NEVER egresses off-platform (B-INV-15). FK → eval_touchpoints.';

-- RLS: tenant-safe + admin read. Reads are admin-only on the request path (the
-- cost-tab surface is admin-gated); the runner/recorder writes via service_role
-- (bypasses RLS). No authenticated INSERT policy — writes are service-only,
-- which keeps the table tenant-safe (no authenticated user can forge a row).
-- anon holds no privilege.
ALTER TABLE public.ai_call_events ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.ai_call_events'::regclass);
REVOKE SELECT ON TABLE public.ai_call_events FROM anon;

CREATE POLICY ai_call_events_select_admin ON public.ai_call_events
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');
