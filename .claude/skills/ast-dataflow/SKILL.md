---
name: ast-dataflow
description: "Catalogue and entry point for the ast-dataflow skill family. Use when you need type-checker-resolved symbol analysis across the KH codebase: finding callers, tracing column reads/writes, auditing dead exports, inspecting string-literal sites, resolving re-export chains, or profiling type evolution. Examples: 'find all callers of sb()', 'which files read bid_questions.project_id', 'are there dead exports in lib/bid', 'verify this rename is complete', 'pin the wrong-argument bug in classifyContent'"
allowed-tools:
  - Bash
  - Read
  - Edit
---

# ast-dataflow — Skill catalogue

## What ast-dataflow is

ast-dataflow is a type-checker-resolved static analysis library for the
Knowledge Hub TypeScript codebase. It wraps `ts-morph` (the TypeScript
compiler API) and exposes twelve queries as a CLI and as a programmatic
module. Unlike `grep` or text search, every query resolves symbols through
TypeScript's type system — aliases, re-exports, and indirect references are
all tracked.

**Primary CLI:**

```bash
bun scripts/ast-dataflow-cli.ts <query> [args]
```

---

## When to use ast-dataflow vs. sibling tools

| Tool | Use when |
|---|---|
| **ast-dataflow** | You need file-and-line resolution with TypeScript semantic precision: exact call sites, type-position references, column access sites, or string-literal AST context |
| **gitnexus** | You need process-level blast radius, execution-flow orientation, or automated rename — but do NOT need full indirect-caller enumeration |
| **Knip** | You need entry-point reachability (binary yes/no: dead vs. reachable) — but NOT semantic confirmation of why |
| **ccc** | You need concept-based file discovery across all corpus types (TS, Python, SQL, Markdown) — but NOT AST precision |

ast-dataflow and gitnexus are **complementary, not competing.** Use them
together — see the Cross-tool patterns section below.

---

## Query catalogue

Eleven queries are available. Match your question to the right query:

### callers — "who calls this function?"

```bash
bun scripts/ast-dataflow-cli.ts callers \
  --symbol 'lib/supabase/safe.ts:sb'
```

Returns every call site of a function, including indirect callers (arrow-
function callbacks, Promise.all wrappers, HOC patterns) that gitnexus may
not index. Each row carries: `file`, `line`, `column`, `enclosing` (the
function/method that wraps the call), `resolution` (`direct` | `aliased` |
`indirect`).

**Use when:** debugging a wrong-argument bug, verifying a contract
(e.g. UUID shape), or confirming every caller before modifying a function.
**Companion skill:** `ast-dataflow-call-chain-pin` (Pattern 5).

---

### references — "every TypeScript reference to a symbol"

```bash
bun scripts/ast-dataflow-cli.ts references \
  --symbol 'types/bid.ts:BidState'
```

Returns all references classified by kind: `read`, `write`, `typeReference`,
`typeOnly`, `jsxComponent`, `reexport`. Confidence is always `exact` (type-
checker resolved). Useful for pre-rename impact and for confirming a rename
swept all sites.

**Use when:** pre-rename reference count, post-rename verification, type-
evolution blast radius.

---

### importers — "which files import this module?"

```bash
bun scripts/ast-dataflow-cli.ts importers \
  --module '@/lib/supabase/safe'
```

Returns all files that import the given module path, including named import
details (`namedImports`, `importStyle`). After a rename, the old module path
should return `error.kind === 'unknown_file'` (the module is gone). Any
results means missed imports.

**Use when:** post-rename import-path sweep, confirming no barrel-chain gaps,
checking who depends on a module before removing it.

---

### string-literal-uses — "find string literals with AST context"

```bash
bun scripts/ast-dataflow-cli.ts string-literal-uses \
  --value 'generateDigest'
```

Finds every string literal matching the value and classifies its AST
context: `viMock` (Vitest `vi.mock(...)` argument), `jsxProp` (JSX
attribute value), `sqlTag` (SQL tagged template), `envKey`
(`process.env[...]` key), `argument` (other call-expression argument).
Python and SQL files outside the ts-morph corpus are NOT covered — run a
`grep` sweep in addition for those.

**Use when:** post-rename string-site sweep, auditing `vi.mock` paths,
finding hardcoded URL fragments.

---

### column-reads — "every TS file that reads a Supabase column"

```bash
bun scripts/ast-dataflow-cli.ts column-reads \
  --table content_items --column summary
```

Walks the TypeScript call graph to find every `.select()` / `.from()` call
chain that references the named table column. Handles aliased column
selects and type-narrowed reads.

**Use when:** pre-column-rename impact, verifying a column migration swept
all read sites, column-access audits.

---

### column-writes — "every TS file that writes a Supabase column"

```bash
bun scripts/ast-dataflow-cli.ts column-writes \
  --table content_items --column summary
```

Finds `.insert()`, `.update()`, `.upsert()` call chains writing the named
column. Companion to `column-reads`.

**Use when:** pre-column-rename impact, write-path audits, verifying no
direct writes bypass `sb()` wrappers.

---

### dead-exports — "exports with no non-test callers"

```bash
bun scripts/ast-dataflow-cli.ts dead-exports \
  --scope 'lib/bid/**'
```

Returns exported symbols with zero non-test importers. Each row includes
`testOnly` (true = only referenced from `__tests__/`) and
`reachableImporters` count. Scope is a glob or comma-separated glob list.

**Use when:** pre-delete safety check, dead-code audits, Knip false-positive
confirmation. **Companion:** Pattern 1 (Knip dead-exports verifier).

---

### reexport-chain — "trace the full barrel chain for a symbol"

```bash
bun scripts/ast-dataflow-cli.ts reexport-chain \
  --symbol '@/lib/bid:createBid'
```

Walks re-export declarations from the entry point to the source declaration,
resolving the full chain. Exposes `BARREL_DETECTED` when a symbol escapes
through an index file. Use to confirm Knip false positives caused by barrel
chains.

**Use when:** debugging "why is Knip saying this is dead but it clearly
isn't?", auditing barrel-chain depth, verifying no-barrel-re-exports rule.

---

### type-evolution — "all type-position references for a TypeScript type"

```bash
bun scripts/ast-dataflow-cli.ts type-evolution \
  --type 'types/bid.ts:BidState'
```

Enumerates declaration sites, re-exports, aliases, generic specialisations,
`extends` clauses, conditional types, and mapped-type positions. Returns
rows classified as `typeReference`, `typeOnly`, `read`, or `reexport`.
Gitnexus `impact` covers runtime callers; `type-evolution` covers the type-
position references gitnexus does not index.

**Use when:** pre-type-rename full blast radius, distinguishing runtime
callers (test coverage needed) from type-position references (compile-time
fix only). **Companion:** Pattern 6 (type-evolution agreement check).

---

### enum-uses — "all reads of a specific enum or `as const` member"

```bash
bun scripts/ast-dataflow-cli.ts enum-uses \
  --enum BID_STATES [--member DRAFT]
```

Returns every property-access read, type-position reference, and string-
literal equivalent of the named enum or `as const` member. Handles both
TypeScript `enum` declarations and `as const` object idioms (the KH
convention). Knip has documented false positives on `as const` patterns;
this query provides the semantic confirmation.

**Use when:** auditing before retiring an enum member, confirming a Knip
unused-member report, `as const` property lifecycle audits. **Companion:**
Pattern 8 (Knip enum-member confirmation).

---

### flow-trace — "step-by-step call path from entry to target"

```bash
bun scripts/ast-dataflow-cli.ts flow-trace \
  --entry 'app/api/bid/[id]/route.ts:GET' \
  --target 'lib/supabase/safe.ts:sb'
```

Walks the call graph from an entry point to a target symbol, returning each
hop with its file, line, and hop kind (`call` | `import` | `typeRef`).
Useful for tracing the full execution path of a request through the KH
API layer.

**Use when:** understanding how a request reaches a specific function,
tracing the auth chain, verifying that a write path goes through `sb()`.

---

### type-drift-detect — "API response-interface drift classification"

```bash
bun scripts/ast-dataflow-cli.ts type-drift-detect
```

Classifies every response-interface candidate in the codebase into one of
four buckets: `enforced` (fetcher + route both use it), `fetcher-only`,
`route-only`, or `unused`. Implements PRODUCT.md WP-D (R-WP17). Runs
across the full corpus — no scoping argument needed.

**Use when:** API type-drift audits, enforcing symmetric interface coverage
before an API release, identifying interfaces that have diverged between
fetcher and route definitions.

---

## Cross-tool patterns

Nine patterns document high-leverage compositions of ast-dataflow with
gitnexus, Knip, and ccc. Full write-up:
`${KH_PRIVATE_DOCS_DIR}/docs-site/src/content/docs/specs/id-16-ast-dataflow-tool/investigations/R-WP11-cross-tool-integration.md`

| # | Pattern | Tools | Leverage |
|---|---------|-------|----------|
| 1 | Knip dead-exports verifier | `knip --reporter json` + `dead-exports` + `reexport-chain` | High |
| 2 | GitNexus blast radius refinement | `gitnexus_impact` + `callers` / `column-reads` / `references` | High |
| 3 | cocoindex-code wide-net + string-literal precision | `ccc search` + `string-literal-uses` | High |
| 4 | Rename-sweep verifier | `gitnexus_rename` + `string-literal-uses` + `importers` + `references` | High |
| 5 | Call-chain pin for wrong-argument bugs | `gitnexus_context` + `callers` | High |
| 6 | Type-evolution agreement check | `gitnexus_impact` + `type-evolution` | Medium |
| 7 | Architectural invariant verification | `ccc guide` + `callers` / `string-literal-uses` | Medium |
| 8 | Knip enum-member confirmation | `knip --reporter json` + `enum-uses` | Medium |
| 9 | Concept-scoped dead-export audit | `ccc search` + `dead-exports --scope` | Low |

---

## Skill files

Three skills are available. Choose by task shape:

| Task | Skill |
|---|---|
| Verify a rename is complete after `gitnexus_rename` | `ast-dataflow-rename-sweep` |
| Pin the exact call site passing a wrong argument value | `ast-dataflow-call-chain-pin` |
| Orient yourself — which query to use, which pattern to apply | This file (catalogue) |

Full skill paths:

- `.claude/skills/ast-dataflow/ast-dataflow-rename-sweep/SKILL.md` (Pattern 4)
- `.claude/skills/ast-dataflow/ast-dataflow-call-chain-pin/SKILL.md` (Pattern 5)

---

## Error contract

All queries return a `QueryResponse<T>` with a top-level `error` field on
failure:

```typescript
{
  query: string;
  args: Record<string, unknown>;
  error: {
    kind: 'ambiguous_symbol' | 'unknown_file' | 'unknown_symbol' | 'no_results';
    message: string;
    hint?: string;
  };
  durationMs: number;
}
```

Common error codes:

| `error.kind` | Cause | Resolution |
|---|---|---|
| `ambiguous_symbol` | Symbol name matches multiple declarations | Qualify with `file:symbol` form |
| `unknown_file` | Module path does not exist in the project | Check the path; file may have been renamed |
| `unknown_symbol` | File exists but the named export is not found | Check the export name; may be default-exported |
| `no_results` | Query ran successfully but found zero matches | Valid empty result — the corpus has no matches |

---

## Related

- `${KH_PRIVATE_DOCS_DIR}/docs-site/src/content/docs/specs/id-16-ast-dataflow-tool/TECH.md` — full technical specification
- `${KH_PRIVATE_DOCS_DIR}/docs-site/src/content/docs/specs/id-16-ast-dataflow-tool/PRODUCT.md` — invariant test suite
- `${KH_PRIVATE_DOCS_DIR}/docs-site/src/content/docs/specs/id-16-ast-dataflow-tool/ROADMAP.md` — wave plan, WP status
- `${KH_PRIVATE_DOCS_DIR}/docs-site/src/content/docs/specs/id-16-ast-dataflow-tool/investigations/R-WP11-cross-tool-integration.md` — cross-tool pattern brief
