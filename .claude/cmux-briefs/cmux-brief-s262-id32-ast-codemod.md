# cmux Terminal Brief — ID-32 OPS-T1 codemod (S262)

**Your role:** Orchestrator for Task **ID-32** (single-track `main`). Run the
`workflow-orchestration` skill — dispatch worktree-isolated Executor/Checker agents per
Subtask, cherry-pick onto `main`.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-32** (the Subtask `details` fields are
  load-bearing — read them; don't re-derive)
- `docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/{PRODUCT,TECH,PLAN}.md` +
  `route-shape-inventory.md`

**Status:** 32.1–32.13 done; 32.17 / 32.18 / 32.19 done. Remaining: **32.14 → 32.15 →
32.16, STRICTLY SEQUENTIAL** (not parallelizable among themselves).

**Sequence:**

1. **32.14** Apply mode + format pass — deps `[12,13]` (both done) → **READY**.
2. **32.15** Verifier integration with `type-drift-detect` — deps `[14]`.
3. **32.16** Acceptance gate (AC-1..AC-10 end-to-end probe) — deps `[15,17]` (17 done).

**Session-specific deltas (not in the ledger):**

- **OQ-3 RESOLVED (Liam, S262):** 32.16 **AC-9 = "no _new_ lint errors"**, NOT absolute 0.
  Write the acceptance assertion on the lint-count **delta** (before vs after the codemod
  run), not on zero.
- **Chain-order is settled:** canonical **Source B → Source A** (reconciled S261; matches
  the shipped `inferSchema()` at `wrap-define-route.ts:467-484`, commit `b4a04df6`). PLAN
  §4 + TECH §3 already carry the canonical chain-order subsection; backlog ID-148 resolved
  → 32.19 done. Do not re-litigate.

**Merge cadence:** worktree-isolated Executor per Subtask → Checker-gate → cherry-pick
onto `main`. **Other cmux terminals share `main` this session —
`git fetch origin main && git reset --hard origin/main` before every push**, cherry-pick
(never merge) parallel branches.
