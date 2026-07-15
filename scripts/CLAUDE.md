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
- **Known full-suite baseline delta (environmental, NOT a regression — do not
  re-adjudicate):** sandboxed runs skip more (`oq/*` heredoc EPERM; memo-fingerprint
  probes skip when the Rust engine can't boot). A green sandboxed run ≈ 1814 passed /
  14 skipped as of 2026-07-12 (post the {132.34} overlay + {132.35} producer-wiring/deploy-fix wave). (The former delta (b) — 2 memo-fingerprint CASE-A
  failures from stale probe-stub taxonomy — was fixed S455, bl-417.)
