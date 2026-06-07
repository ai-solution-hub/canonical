# cmux Terminal Brief — ID-20 per-Task mirror + task-view (S262)

**Your role:** **SINGLE** orchestrator for Task **ID-20** (cross-repo: this KH repo
**and** the external `task-view` repo). Run `workflow-orchestration`. Do not split ID-20
across terminals — one owner.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-20** (Subtask `details` are load-bearing)
- `docs/specs/id-20-per-task-mirror/{PRODUCT,TECH,PLAN}.md`

**Status:** 20.1–20.11, 20.16, 20.17 done. Pending: 20.12, 20.13, 20.15, 20.18, 20.19,
20.20, 20.21, 20.22, 20.23.

**Critical sequence (gates encoded in deps):**

1. **20.19** Re-vendor task-view schemas to live KH ledger shape — deps `[17]`. **Gates
   20.12 + 20.13.**
2. **20.12** KH-side CI glue + initial mirror commit — deps `[11,19]`.
3. **20.13** KH acceptance verification + task-view **v0.1.0 GitHub Release** — deps
   `[11,12,19]`. Spans both repos.

**Side-lane (same owner, deps `[17]` done — schedule around the critical path):** 20.18
(SPA-only invariant coverage, Scenarios 14–17), 20.20 (launch-path fail-on-load fix),
20.21 (record-level path resolution in CLI), 20.22 (auto-regen mirror on server boot),
20.23 (restrict multi-field PATCH auto-regen). **20.15** (record-level CREATE/DELETE +
cross-ledger txn) deps `[13]` → after 20.13.

**Session-specific deltas (not in the ledger):**

- **`cancelled` is now a VALID subtask status on the live KH ledger** (S262 commit
  `2341c660`; ID-25.1–25.4 now carry it). **20.19 re-vendor MUST pick up the amended
  `SubtaskStatus`** in `lib/validation/task-list-schema.ts`
  (`.exclude(['spec_needed','imp_deferred'])` — `'cancelled'` absent from the exclude
  list). Re-vendor from current `main` HEAD or the vendored copy will reject live ledgers.
- **task-view pushed to its repo `main` by Liam (S262).**
- **Programmatic-mutation context:** 20.19 unlocks tier-1 of the ID-35 ledger CLI (status
  flips / journal appends / field updates); 20.15 unlocks the full 10-subcommand surface.
  This is why 20.19 is the keystone.

**Merge cadence:** KH-side → cherry-pick onto `main`, fetch-before-push (shared `main`).
task-view side → its own `main`.
