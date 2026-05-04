# CI Workflow Documentation Follow-up

Purpose: track the reference documentation updates needed after the recent CI/CD
hardening work, so the implementation can be documented consistently once the
branch flow has settled.

## Recent workflow changes to document

- Quality CI now uses a dedicated pre-check job plus four Vitest file shards.
- Integration tests run against the Staging environment as a hard CI job.
- E2E smoke has staging preflight cleanup and orphaned history cleanup
  safeguards.
- MCP eval now builds once, seeds a deterministic metadata-flagged Q&A corpus
  once, then fans out L1/L3/L4 eval jobs against the shared build artifact and
  persistent seed rows.
- Stale test artifact cleanup must preserve rows with
  `metadata.mcp_eval_seed=true` while still deleting temporary `[MCP-EVAL]`
  mutation fixtures.
- Schema parity is manual and currently surfaces environment drift in `auth`,
  `extensions`, and public SQL function definitions.

## Reference documents likely needing updates

- `docs/runbooks/ci.md`: current CI job graph, shard responsibilities, MCP
  build/seed/eval flow, expected gating behavior.
- `docs/runbooks/github-environments.md`: Production versus Staging environment
  variable/secret usage for quality, integration, E2E, MCP build, and MCP eval
  seed jobs.
- `docs/runbooks/staging-refresh.md`: staging reference data expectations,
  deterministic MCP eval seed corpus, and cleanup safety rules.
- `docs/audits/kh-production-readiness-phase-1/STATUS-change-log.md`:
  production-readiness CI stabilization milestones.
- `docs/audits/kh-production-readiness-phase-1/STATUS-handoffs.md`: handoff
  notes for remaining schema parity and fixture documentation follow-up.
- `docs/audits/kh-production-readiness-phase-1/specs/wp-g4.4-mcp-eval-ci-spec.md`:
  update acceptance notes for the persistent seed job and no-data failure
  behavior.
- `docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res7-staging-data-strategy-spec.md`:
  record the deterministic Q&A fixture strategy and why production-derived data
  remains optional future work.

## Open documentation questions

- Decide whether schema parity should continue comparing Supabase-managed `auth`
  and `extensions` objects strictly, or normalize/ignore known managed drift.
- Decide whether staging-only `auth.users` indexes are desired production
  optimizations; if yes, capture them in a migration, otherwise remove them from
  staging.
- Decide how to describe comment-only SQL function body drift, since
  `pg_dump --no-comments` does not remove comments embedded inside function
  source.
