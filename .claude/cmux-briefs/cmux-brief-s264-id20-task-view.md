# cmux Terminal Brief — ID-20 per-Task mirror + task-view (S264)

**Your role:** **SINGLE** orchestrator for Task **ID-20** (cross-repo: this KH repo
**and** the external public `task-view` repo). Run `workflow-orchestration`. Do not split
ID-20 across terminals — one owner.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-20** (20.18 + 20.24 `details` are
  load-bearing)
- `docs/specs/id-20-per-task-mirror/{PRODUCT,TECH,PLAN}.md`

**Status:** 20.1–20.17, 20.19–20.23 **done**. Remaining: **20.24 → 20.18** (the SPA
hydration pair — sequential, 20.18 tests what 20.24 builds).

**Sequence:**

1. **20.24** SPA client-hydration — wire the SSR edit affordances to fire PATCH in-browser
   (Vite client entry). 20.17 shipped SSR-only (NOT hydrated); this is the deferred client
   wiring. **Do first** — 20.18 cannot test a hydrated viewer that does not exist yet.
2. **20.18** SPA-only invariant coverage — the deferred **Scenarios 14–17 + 24** against
   the now-hydrated viewer.

**Session-specific deltas (not in the ledger):**

- **task-view is now PUBLIC** and **v0.1.0 is released** (tag `v0.1.0-task-view` =
  `eda173c`). The KH CI `ledger-mirror-parity` job clones it at that tag and runs
  `node bin/task-view.js --check` (the `bun install -g github:…@tag` route is broken —
  specifier-mangle 404, even public — so clone-at-tag is canonical). If 20.24/20.18 change
  the generator or schema vendor, **bump the tag** + the `TASK_VIEW_TAG` literal in
  `ci.yml` on a new release.
- **Schema vendor is current** (20.19 re-vendored to the live `themes[]` +
  `capability_theme` shape; `cancelled` is a valid SubtaskStatus). Re-vendor again only if
  the live ledger shape drifts (a `task-view-vendor-drift.yml` non-blocking reminder fires
  on `lib/validation/{task-list,roadmap,backlog}-schema.ts` changes).

**Workflow discipline (S264 lessons —
`docs/specs/workflow-evaluation/feedback-dossier-S264.md` §2; ID-48 formalises):**
validate contracts/APIs against the INSTALLED code before spec'ing or implementing — if
the spec contradicts reality, ESCALATE, don't execute it blindly (ID-32 B4 + ID-28
`bind_target` were specs against assumptions); run the real-corpus/integration probe
CONTINUOUSLY, not as a final gate; keep ACs non-vacuous (lint-delta paired with
tsc/no-undef); `bun run format` before every commit.

**Merge cadence — WORKER-BRANCH-ONLY (S262 pivot):** KH-side commits → YOUR worker branch
only (parent O-of-O integrates at teardown; do NOT push to KH `main`). **task-view repo**
changes → its own `main` (coordinate the release/tag bump with Liam). Raise OQ via the
`OQ-pending.md` sentinel.
