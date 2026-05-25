# Codemods

One-off code-modification scripts that run over the Knowledge Hub source tree via
[`ts-morph`](https://ts-morph.com). Each codemod is a standalone CLI: it is not part of
the build, the test suite, or CI. You run it by hand, review the diff, and commit the
result.

## `wrap-define-route.ts` — OPS-T1 route migration

Wraps every mechanisable `app/api/**/route.ts` handler in the `defineRoute(...)` helper so
the route's response shape is validated against a Zod `ResponseSchema`. Routes that cannot
be transformed safely (cron handlers, the MCP transport route, naked handlers with no auth
wrapper, and multi-method files that need a per-method schema decision) are reported for
manual follow-up rather than rewritten.

- **Spec:** `docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md` (behaviour) and
  `TECH.md` (implementation). Section §7 of PRODUCT.md defines the verifier workflow this
  README documents.
- **Runbook:** `docs/runbooks/ops-t1-codemod.md` — the end-to-end developer walk-through.
  Read the runbook for the full procedure; this README is the quick reference that lives
  next to the code.

### Modes

| Invocation                                          | Effect                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `bun scripts/codemods/wrap-define-route.ts`         | **Dry-run** (default). Writes the two report artefacts; touches no `route.ts`.                         |
| `bun scripts/codemods/wrap-define-route.ts --apply` | **Apply.** Rewrites the mechanisable routes on disk, then runs `bun run format` over the modified set. |
| `… --scope app/api/<subtree>`                       | Restrict the run to routes whose path contains the fragment.                                           |
| `… --help`                                          | Print usage.                                                                                           |

Both modes always emit, into `docs/generated/`:

- `codemod-dry-run.md` — human-readable diff preview, verdict tally, and shape
  distribution.
- `codemod-needs-manual.json` — the structured MANUAL / NEEDS-REVIEW list with reason
  codes.

Override the artefact destination with the `CODEMOD_OUTPUT_DIR` environment variable; the
test suite redirects emission to a `tmpdir()` so it never dirties the committed tree.

> **Prerequisite:** `docs/generated/type-drift-baseline.json` must exist before you run
> either mode — the codemod's schema-inference step reads it to bind a route's response
> interface to its co-located `ResponseSchema`, and aborts with an `ENOENT` if the file is
> missing. The baseline is produced by the `type-drift-detect` verifier (see below).

## The verifier: `type-drift-detect`

The regression gate that pairs with this codemod is the read-only ast-dataflow query
`type-drift-detect` (`lib/ast-dataflow/queries/type-drift-detect.ts`), exposed through the
CLI:

```bash
bun run ast-dataflow type-drift-detect --pretty   # human review (Markdown)
bun run ast-dataflow type-drift-detect --ci       # gate: exits 1 on new drift
bun run ast-dataflow type-drift-detect --update-baseline  # regenerate baseline
```

It classifies every response-interface candidate as `enforced`, `fetcher-only`,
`route-only`, or `unused`. A `fetcher-only` interface is a gap: a client fetcher consumes
the type but no route annotates it. The `--ci` gate fails the build if any `fetcher-only`
interface appears that is **not already recorded** in
`docs/generated/type-drift-baseline.json`. Closing a gap therefore means removing its
entry from the baseline so it can never silently reappear.

> **The verifier recognises route annotations via the handler return type, not via the
> `defineRoute(...)` wrap.** Wrapping a route does not, on its own, move its interface out
> of the `fetcher-only` bucket. The baseline must be updated explicitly to record each
> closed gap. This is the whole reason steps 5–6 below exist.

## Post-migration workflow (PRODUCT §7)

1. **Dry-run** — `bun scripts/codemods/wrap-define-route.ts`.
2. **Review** `docs/generated/codemod-dry-run.md` and `codemod-needs-manual.json`.
3. **Author schemas** — for every route the dry-run marks with a `z.unknown()` placeholder
   (carrying a `// TODO(OPS-T1): author ResponseSchema` comment), write the real
   `ResponseSchema` object.
4. **Apply** — `bun scripts/codemods/wrap-define-route.ts --apply`.
5. **Human review** — `bun run ast-dataflow type-drift-detect --pretty`.
6. **Update the baseline** — edit `docs/generated/type-drift-baseline.json` to remove
   closed-gap entries (or regenerate with `--update-baseline`).
7. **Test + lint** — `bun run test` and `bun lint`.
8. **CI gate** — `bun run ast-dataflow type-drift-detect --ci` (must exit `0`).
9. **Raise the migration PR.**

The full procedure, with worked examples and troubleshooting, is in
`docs/runbooks/ops-t1-codemod.md`.

## Test coverage

- `__tests__/scripts/codemods/wrap-define-route.test.ts` — classifier, schema inference,
  rewrite emitters, and apply-mode disk writes.
- `__tests__/scripts/codemods/wrap-define-route.classifier.test.ts` — synthetic in-memory
  classifier cases.
- `__tests__/integration/ops-t1-codemod-verifier.integration.test.ts` — the end-to-end
  dry-run → apply → `type-drift-detect --ci` pipeline against a self-contained temporary
  corpus. Runs via `bun run test:integration`.
