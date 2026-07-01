# Empirical verification — full protocol

Detail behind §Empirical verification in `shared-discipline.md`: the pre-ratification
empirical import-and-call check for specs that cite external-library APIs.

## What to verify

1. **Identify cited external symbols.** Grep the spec for module names (`import X from`
   patterns in code blocks; "uses `pkg.foo()`" in prose; SDK / API references). List per
   `module.symbol`.
2. **Look up the pinned version.** Python: `grep '^<package>' requirements.txt`.
   TypeScript: `jq -r '.dependencies["<package>"]' package.json` (also check
   `devDependencies`).
3. **Run the import-and-call check** (sandbox-disabled where needed for cocoindex or other
   LMDB-touching packages):
   ```
   python3 -c "from <module> import <symbol>; print(<symbol>)"
   ```
   TypeScript symbols — use ast-dataflow `references` or `tsc --noEmit` against a
   throwaway file that imports the symbol; runtime `bun --print` may not surface type-only
   export mismatches.
4. **Record verification in the spec** (a `## Verification` section, or a footnote near
   each citation): date (DD/MM/YYYY), pinned version (`<package>==<version>`), symbol path
   checked, and result — `PRESENT` / `ABSENT` / `SIGNATURE_DRIFT` (signature differs from
   cited shape) / `BEHAVIOUR_DRIFT` (signature matches but runtime behaviour differs from
   spec assumption).

## Escalation on failure

- `ABSENT` or `SIGNATURE_DRIFT` → STOP. Do not return the spec for ratification. Escalate
  to the Orchestrator with verification evidence and recommend either (a) spec revision to
  use the actual installed API, or (b) version-pin upgrade if the cited shape exists in a
  newer release.
- `BEHAVIOUR_DRIFT` (signature OK, runtime semantics changed) → record the drift inline
  and either revise the spec or surface to the Orchestrator for amend-in-place.
  Orchestrator's call.

## Scope

Applies to external-library symbols in RESEARCH / PRODUCT / TECH / PLAN artefacts and any
Subtask `details` referencing external library calls — including externally-sourced claims
gathered during `{N.1}` research (never accepted from prose). Does NOT apply to internal
KH symbols (covered by ast-dataflow + gitnexus + Knip), test-internal helpers, or
standard-library / framework built-ins (Next.js, React, Node, Python stdlib).

## Checker cross-check

The Checker re-runs a fresh import-and-call check at audit time and verifies the recorded
block matches the current pin (see `task-checker.md` `empirical-grounding` axis for the
severity mapping).
