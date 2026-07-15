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

| File                  | Role (post-R1b)                                                                                                                                                   | Vendored from (task-view `packages/server/`) |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `detect-schema.ts`    | `loadLedger` parses + document-kind-detects the on-disk ledger before any mutation                                                                                | `detect-schema.ts`                           |
| `patch-apply.ts`      | `fieldPatchMutation` re-validates field edits (the `FieldPatch` schema oracle)                                                                                    | `patch-apply.ts`                             |
| `record-mutate.ts`    | `insertRecord` / `removeRecord` — the create/delete/promote duplicate-id oracle                                                                                   | `record-mutate.ts`                           |
| `initiatives-tree.ts` | Shared tree-walk primitives (`resolveInitiativeNode`, `findProjectBySlug`, …) `patch-apply.ts`/`record-mutate.ts` import (INV-13) — ID-148.12 vendor-set addition | `initiatives-tree.ts`                        |

These remain **vendored copies** of task-view's `packages/server/*` primitives; the only
intentional difference from upstream is the schema import specifier
(`@task-view/schemas/*` → `@/lib/validation/{task-list,initiatives,backlog}-schema.ts`,
which export the identical symbols). The bodies are byte-faithful.

**Pinned release:** `v0.11.0-task-view` (the same `TASK_VIEW_TAG` used by
`scripts/regen-mirrors.sh` and `ci.yml`).

**ID-148.12 re-vendor lineage (Option C).** The three retained primitives had NOT actually
been re-synced since **`v0.5.0-task-view`** — `ci.yml`'s `TASK_VIEW_TAG` had advanced to
`v0.9.0-task-view` in the interim purely to drive schema-fetch/mirror-regen, without a
primitive re-vendor (the non-blocking drift workflow's warnings went unactioned). The
`v0.5.0` → `v0.10.1` re-vendor therefore carries substantially more than the ID-148.10
roadmap→initiatives repurpose. The full diff decomposes into exactly five categories
(Checker-verifiable — nothing outside this list is expected):

1. **Roadmap→initiatives arm swap** — `detect-schema.ts`'s `kind:'roadmap'` arm (+
   `KNOWN_DOCUMENT_NAMES` literal `"Knowledge Hub Roadmap"`) replaced by
   `kind:'initiatives'` (+ `"Canonical Platform - Initiatives"`),
   `RoadmapSchema`→`InitiativesSchema`; the nested initiatives tree-walk arm in
   `patch-apply.ts`/`record-mutate.ts` (INV-13) replaces the flat `themes[]` handling.
2. **Schema import-specifier convention** — `@task-view/schemas/*` → `@/lib/validation/*`
   (unchanged convention, now pointing at `initiatives-schema.ts` instead of
   `roadmap-schema.ts`).
3. **ID-90.9 U6 (task-view-native, unrelated to ID-148):** `patch-apply.ts`'s `FieldPatch`
   widens from a single-shape interface to a discriminated union (`{fieldPath,newValue}` |
   `{fieldPath,appendText}`), with a new exported `applyValueToLeaf` helper (first-class
   server-side append). **Unused from KH's oracle callsites** — `scripts/ledger-cli.ts`'s
   `--append` stays a CLIENT-SIDE concatenation (ID-35.39 Item C: reads the existing
   `notes` value, prepends, sends as an ordinary `newValue` patch); the oracle is called
   only via `detectSchema` / `applyPatches` / `insertRecord` / `removeRecord`, never
   `applyValueToLeaf` directly.
4. **ID-90.9 U5 (task-view-native, unrelated to ID-148):** `record-mutate.ts` gains
   `withCreateDefaults`/`CREATE_DEFAULTS`, `nextId`, the `_idHighWater` monotonic
   allocator (`effectiveHighWater` + private helpers), `insertSubtasks`, `removeSubtask`.
   Upstream's own header notes these were "Ported from the KH ledger-CLI
   (scripts/ledger-cli.ts)" — i.e. task-view absorbed KH's OWN native logic for its
   internal UI-driven create/delete surface. **Unused from KH's oracle callsites** — KH's
   `scripts/ledger-cli.ts` runs its own native `nextId`/`withCreateDefaults`/subtask-CRUD,
   never the vendored copies. Expect new `knip` unused-export findings for these symbols —
   this is expected, not a regression; do not chase them.
5. **The `initiatives-tree.ts` module addition** — a new file, not present at v0.5.0,
   vendored per the table above (transitively imported by `patch-apply.ts`/
   `record-mutate.ts`).

Byte-faithful, whole-file-copy convention holds (see Re-vendor procedure below) — the five
categories above are NOT hand-curated out; the whole upstream file is copied as-is
(import-specifier rewire only) so the drift-detection workflow stays meaningful (a
hand-diffed copy would show permanent false-positive drift on every future run).

**ID-148.13 re-vendor lineage (`v0.10.1` → `v0.11.0`, TECH §2 INV-3 status-enum gate).**
Curator-routed finding (S474): at `v0.10.1` INV-3's server-side half was NOT implemented —
zero executable `PROJECT_STATUSES`/`INITIATIVE_STATUSES` references anywhere in
task-view's `packages/server/{patch-apply,record-mutate}.ts` or `gates/*`; the CLI's
`requireValidProjectStatus` (`scripts/ledger-cli.ts`) was the ONLY enforcement, a gap the
CLI's own jsdoc disclosed. `{148.13}` added upstream `gates/status-enum-gate.ts`
(mirroring the `gates/budget-gate.ts`/`gates/record-set-gate.ts` idiom), wired into
`packages/server/patch-server.ts` at the same two hook points as the budget gate (PATCH
field-patches + POST record create).

**Zero delta to the four RETAINED files in this directory.** The new gate — and its wiring
— lives entirely in `patch-server.ts` and `gates/status-enum-gate.ts`, NEITHER of which is
part of the CLI-side validation oracle vendored here (this oracle only ever covers
`detect-schema.ts`/`patch-apply.ts`/`record-mutate.ts`/`initiatives-tree.ts` — the
gate-registration surface, like `gates/budget-gate.ts` and `gates/record-set-gate.ts`
before it, is server-only). Verified byte-identical (SHA-256) against the prior sync point
for all four retained files, and against the six vendor-bundle schema assets
(`initiatives-schema.ts` included — the gate consumes `PROJECT_STATUSES`/
`INITIATIVE_STATUSES`, both already exported at `v0.10.1`, no schema export change
needed). The server-side enforcement is real regardless of vendoring: canonical's
`scripts/ledger-server-client.ts` routes every initiatives-kind mutation through the SAME
running task-view patch-server process this gate is wired into, so the CLI's
`--ledger-dir`-scoped writes hit the new gate live.

**Disposition.** These four modules ride **{68.30}**: when the schemas migrate upstream
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
   `scripts/regen-mirrors.sh` (the latter derives its tag from `ci.yml` automatically —
   see `scripts/regen-mirrors.sh`'s `TASK_VIEW_TAG` resolution, no separate literal
   there).
2. Copy the four RETAINED files above (table, including `initiatives-tree.ts`) from the
   new task-view release, re-applying only the `@task-view/schemas/*` →
   `@/lib/validation/*` import rewire — whole-file copy, never hand-diffed (see the
   ID-148.12 re-vendor lineage note above for why: a hand-curated copy defeats the
   drift-detection workflow's purpose).
3. Re-vendor the schemas (`lib/validation/*`) per the existing schema re-vendor flow.
4. Inspect the import graph of the retained files at the new tag for any FURTHER new
   transitive modules (as `initiatives-tree.ts` was at ID-148.12) — vendor those too and
   add them to this table + the drift-yml watch/download lists.
5. Run `bun run test __tests__/scripts/ledger-cli*` to confirm the oracle still wires.

The non-blocking `task-view-vendor-drift.yml` reminder surfaces a `::warning::` when the
four retained files (or the schema-arm assets) drift from upstream.

## CLI command surface

`scripts/ledger-cli.ts` is the deterministic mutation CLI; its in-file `USAGE` block is
the authoritative reference. All mutations route through the server transport (R1b); the
record-set + budget gates and serialisation run server-side. `--whole-file` / `--scoped`
remain parseable argv (inv 8) but no longer change the write path (there is no in-process
serialise path to opt between).
