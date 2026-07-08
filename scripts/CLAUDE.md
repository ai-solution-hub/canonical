# Scripts / Python pipeline — directory context

- **Python background output:** set `PYTHONUNBUFFERED=1` or output is invisible.
- **Worktree pytest must run from the worktree CWD:** main-repo-CWD invocations resolve
  `scripts.*` to the MAIN tree's modules (namespace-package hazard — spurious
  failures/passes against stale code).
- **Pipeline taxonomy source:** the Python pipeline reads taxonomy from
  `scripts/tests/fixtures/taxonomy_snapshot.json` (the app uses the DB-driven taxonomy
  via `contexts/taxonomy-context.tsx`; `lib/taxonomy/taxonomy.ts` is a small re-export
  shim for content types and platforms only).
- **`classifyContent` userId must be a UUID:** use the pipeline service account UUID
  (`a0000000-0000-4000-8000-000000000001`), never literal strings.
- Tests: `python3 -m pytest scripts/tests/`; deps: `pip install -r requirements.txt`.
- **Two known full-suite baseline deltas (environmental, NOT regressions — do not
  re-adjudicate):** (a) sandboxed runs skip more (`oq/*` heredoc EPERM); (b) unsandboxed
  runs fail the 2 memo-fingerprint CASE-A tests (stale probe-stub taxonomy, bl-417).
  A green sandboxed run ≈ 1531 passed / 14 skipped as of 2026-07-08.
