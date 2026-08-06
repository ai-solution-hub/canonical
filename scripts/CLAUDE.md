# Scripts / Python pipeline — directory context

- **Python background output:** set `PYTHONUNBUFFERED=1` or output is invisible.
- **Worktree pytest must run from the worktree CWD:** main-repo-CWD invocations resolve
  `scripts.*` to the MAIN tree's modules (namespace-package hazard — spurious
  failures/passes against stale code).
- **Pipeline taxonomy source:** DR-130 retired `taxonomy_snapshot.json` entirely. The
  pipeline's one remaining gate is the inline `_VALID_CONTENT_TYPES` constant in
  `scripts/cocoindex_pipeline/extraction.py` (transitional, pending the id-417 OQ5
  content-type rework). **There is no app-side taxonomy counterpart any more** —
  S537 deleted `TaxonomyProvider`, `contexts/taxonomy-context.tsx` and the whole
  `lib/taxonomy/` directory along with the `taxonomy_domains`/`taxonomy_subtopics`
  tables. Subject taxonomy is not a driving axis (DR-130); the driving axes are
  scope (`scope_tag`), semantics (embeddings + entity extraction) and concept
  membership.
- **`classifyContent` userId must be a UUID:** use the pipeline service account UUID
  (`a0000000-0000-4000-8000-000000000001`), never literal strings.
- Tests: `python3 -m pytest scripts/tests/`; deps: `pip install -r requirements.txt`.
- **Known full-suite baseline delta (environmental, NOT a regression — do not
  re-adjudicate):** sandboxed runs skip more (`oq/*` heredoc EPERM; memo-fingerprint
  probes skip when the Rust engine can't boot). A green sandboxed run ≈ 1814 passed /
  14 skipped as of 2026-07-12 (post the {132.34} overlay + {132.35} producer-wiring/deploy-fix wave). (The former delta (b) — 2 memo-fingerprint CASE-A
  failures from stale probe-stub taxonomy — was fixed S455, bl-417.)
