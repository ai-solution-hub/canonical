# `lib/ledger/` — CLI-side validation oracle (post ID-90.22 R1b/R2)

These modules are the **CLI-side validation oracle** for `scripts/ledger-cli.ts` (the
deterministic mutation CLI over the three KH workflow ledgers
`docs/reference/{task-list,product-roadmap,product-backlog}.json`).

**ID-90.22 cutover (R1b/R2).** The server-ledger cutover (ID-90) moved the authoritative
write path — serialisation, the record-set + budget gates, the discipline sweep and mirror
regen — to the task-view patch-server. The CLI now routes every mutation through the
server transport (`scripts/ledger-cli.ts` → `scripts/ledger-server-client.ts`); the
in-process direct-write path was removed in **R1b**. In **R2** the two write-side
primitives were **deleted** (tombstones below); the three SCHEMA-VALIDATION primitives
below were **retained** as the CLI-side validation oracle — they produce the local
`schema-error` / `walk-error` / `duplicate-id` / `record-not-found` envelopes BEFORE the
server call, so a malformed mutation fails fast client-side and the server re-validates
authoritatively (esc-4, S335).

## Retained — CLI-side validation oracle

| File               | Role (post-R1b)                                                                    | Vendored from (task-view `packages/server/`) |
| ------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| `detect-schema.ts` | `loadLedger` parses + document-kind-detects the on-disk ledger before any mutation | `detect-schema.ts`                           |
| `patch-apply.ts`   | `fieldPatchMutation` re-validates field edits (the `FieldPatch` schema oracle)     | `patch-apply.ts`                             |
| `record-mutate.ts` | `insertRecord` / `removeRecord` — the create/delete/promote duplicate-id oracle    | `record-mutate.ts`                           |

These remain **vendored copies** of task-view's `packages/server/*` primitives; the only
intentional difference from upstream is the schema import specifier
(`@task-view/schemas/*` → `@/lib/validation/{task-list,roadmap,backlog}-schema.ts`, which
export the identical symbols). The bodies are byte-faithful.

**Pinned release:** `v0.8.0-task-view` (the same `TASK_VIEW_TAG` used by
`scripts/regen-mirrors.sh` and the `ledger-mirror-parity` CI job). Re-vendored at ID-102.8
(string-id flip): only `patch-apply.ts` carried a subtask-id seam change
(`Number(subtaskIdRaw)` → digit-string `/^\d+$/` compare); `detect-schema.ts` is
byte-identical upstream v0.4.0↔v0.5.0, and `record-mutate.ts`'s string-id delta is in the
subtask-level allocators (`nextId` / `insertSubtasks` / `removeSubtask`) that are NOT part
of the retained oracle subset — both are pin bumps only.

**Disposition.** These three modules ride **{68.30}**: when the schemas migrate upstream
(PRODUCT inv 62), the oracle is re-homed and the KH copies retire with them. Until then
they stay on the `task-view-vendor-drift.yml` primitive-diff watch list (R3 keeps their
watched paths). They are NOT deleted here.

## Tombstoned — deleted in ID-90.22 R2

- **`atomic-write.ts`** — DELETED. The CLI no longer writes ledger bytes in-process (the
  server's atomic write owns the canonical rename). Its sole consumers were the deleted
  direct-write path (`commitMutation`) and the `promote` staged-write, both removed in
  R1b. Zero importers remained at deletion (ast-dataflow pre-deletion gate: empty).
- **`scoped-serialise.ts`** — DELETED. The KH-authored minimal-diff write primitive
  (`escapeSerialise` / `scopedSerialise` / `scopedSpliceSerialise`). The server now emits
  the OQ-LS-2-conforming minimal-diff bytes; the CLI no longer serialises. Its surviving
  importers at R1b-time were all retired in the same R2 commit (`ledger-renormalise.ts`,
  `ledger-normalise-oqls2.ts`, `ledger-sweep-s269.ts` + their tests). Its upstream twin
  carries the byte-shape coverage (U11).

## Re-vendor procedure (retained modules only)

When task-view cuts a new schema- or primitive-bearing release:

1. Bump `TASK_VIEW_TAG` in `.github/workflows/{ci.yml,task-view-vendor-drift.yml}` and
   `scripts/regen-mirrors.sh`.
2. Copy the three RETAINED files above from the new task-view release, re-applying only
   the `@task-view/schemas/*` → `@/lib/validation/*` import rewire.
3. Re-vendor the schemas (`lib/validation/*`) per the existing schema re-vendor flow.
4. Run `bun run test __tests__/scripts/ledger-cli*` to confirm the oracle still wires.

The non-blocking `task-view-vendor-drift.yml` reminder surfaces a `::warning::` when the
three retained files (or the `ledger-budgets.ts` schema asset) drift from upstream.

## CLI command surface

`scripts/ledger-cli.ts` is the deterministic mutation CLI; its in-file `USAGE` block is
the authoritative reference. All mutations route through the server transport (R1b); the
record-set + budget gates and serialisation run server-side. `--whole-file` / `--scoped`
remain parseable argv (inv 8) but no longer change the write path (there is no in-process
serialise path to opt between).
