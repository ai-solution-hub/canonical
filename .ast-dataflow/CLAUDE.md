<!-- ast-dataflow:start -->

# ast-dataflow — TypeScript Symbol Analysis

ast-dataflow provides type-checker-resolved static analysis via `ts-morph`. Use it for
precise file-and-line answers that GitNexus (graph-level) and Knip (binary reachability)
cannot give: exact call sites, column access sites, string-literal AST context,
barrel-chain tracing, and type-position blast radius.

**CLI:** `bun scripts/ast-dataflow-cli.ts <query> [args]`

## Skill catalogue

| Task                                             | Skill                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Orient: which query to use, which pattern?       | `.claude/skills/ast-dataflow/SKILL.md`                             |
| Verify a rename is complete post-gitnexus_rename | `.claude/skills/ast-dataflow/ast-dataflow-rename-sweep/SKILL.md`   |
| Pin the exact call site passing a wrong argument | `.claude/skills/ast-dataflow/ast-dataflow-call-chain-pin/SKILL.md` |

## When each skill applies

- **Catalogue (`ast-dataflow`)** — start here. Covers all 12 queries (`callers`,
  `references`, `importers`, `string-literal-uses`, `column-reads`, `column-writes`,
  `dead-exports`, `reexport-chain`, `type-evolution`, `enum-uses`, `flow-trace`,
  `type-drift-detect`) and all 9 cross-tool patterns (Knip, gitnexus, ccc compositions).

- **Rename-sweep (`ast-dataflow-rename-sweep`)** — after any `gitnexus_rename` that
  produced `ast_search` edits marked "review carefully". Runs Q1 (string-literal sites),
  Q2 (import-path sweep), Q3 (new-symbol references) and produces a categorised VERDICT
  report.

- **Call-chain pin (`ast-dataflow-call-chain-pin`)** — when a wrong-argument-value bug is
  suspected: wrong UUID shape, wrong string key, missing required field, untyped Supabase
  client. Chains `gitnexus_context` (flow context + direct callers) with `callers` (all
  indirect callers gitnexus does not index) to pinpoint the exact file:line passing the
  wrong value.

## ast-dataflow does not cover Python or SQL files

`ts-morph` operates on the TypeScript corpus only. For string-literal searches that need
to cover Python scripts (`scripts/kb_pipeline/*.py`) or raw SQL migration files
(`supabase/migrations/*.sql`), run a `grep` sweep in addition to any ast-dataflow query.

<!-- ast-dataflow:end -->