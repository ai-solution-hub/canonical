/**
 * `generate-response-schemas.ts` — one-shot dev generator for the
 * R-WP17 ResponseSchema constants consumed by the OPS-T1 codemod's
 * Source-A inference (`scripts/codemods/inference-source-a.ts` →
 * `findSchemaConstant`).
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5, AC-8
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §3.A
 *   - task-list ID-32.20
 *
 * Why a generator (ID-32.20 spike verdict): the 37 R-WP17 baseline
 * interfaces resolve to ~34 live declarations plus 3 stale entries that
 * a post-baseline rename migration (bid→procurement, digest→change-reports)
 * moved/renamed. Hand-authoring 37 Zod object schemas — each mirroring a
 * TS interface with nested object literals, string-literal unions,
 * `Record<>` maps, `readonly` arrays, optional/nullable members, and
 * `extends` chains — would be error-prone and unmaintainable. ts-morph
 * already underpins the codemod; reusing its type checker to walk each
 * interface's *resolved* property set (which transparently flattens
 * `extends`) gives a faithful, repeatable mapping.
 *
 * CORRECTNESS (AC-8): the emitted schema validates the route handler's
 * RETURN payload at runtime via `defineRoute(<Schema>, handler)`. An
 * over-strict schema would reject a valid payload and regress AC-8.
 * Therefore this generator errs PERMISSIVE:
 *   - unknown / un-mappable member types  → `z.unknown()`
 *   - external / DB-generated / generic refs that aren't a plain object
 *     literal → `z.unknown()`
 *   - every emitted `z.object({...})` is `.passthrough()`-equivalent via
 *     `.loose()` so extra wire fields never fail validation
 *   - optional members            → `.optional()`
 *   - `T | null` members          → `.nullable()`
 *
 * RE-RUN:
 *   bun scripts/codemods/generate-response-schemas.ts            # prints block to stdout
 *   bun scripts/codemods/generate-response-schemas.ts --write    # rewrites the managed
 *                                                                  # block in schemas.ts
 *
 * The managed block is delimited by the BEGIN/END markers below so a
 * re-run replaces only the generated region and never clobbers the
 * ~116 hand-authored schemas above it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project, Type } from 'ts-morph';
import type { Symbol as TsSymbol, Node } from 'ts-morph';

// ── Managed-block markers ──────────────────────────────────────────────────

export const BLOCK_BEGIN =
  '// ──────────────────────────────────────────\n' +
  '// BEGIN generated: R-WP17 ResponseSchema constants (ID-32.20)\n' +
  '// Source: scripts/codemods/generate-response-schemas.ts — DO NOT hand-edit.\n' +
  '// Re-run: bun scripts/codemods/generate-response-schemas.ts --write\n' +
  '// ──────────────────────────────────────────';

export const BLOCK_END =
  '// ──────────────────────────────────────────\n' +
  '// END generated: R-WP17 ResponseSchema constants (ID-32.20)\n' +
  '// ──────────────────────────────────────────';

// ── Paths ──────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
const BASELINE_PATH = resolve(
  REPO_ROOT,
  'docs/generated/type-drift-baseline.json',
);
const SCHEMAS_PATH = resolve(REPO_ROOT, 'lib/validation/schemas.ts');
const TSCONFIG_PATH = resolve(REPO_ROOT, 'tsconfig.json');

// ── Baseline → current-declaration resolution ───────────────────────────────

interface BaselineEntry {
  interface: string;
  declaredAt: { file: string; line?: number };
}

/**
 * Three R-WP17 baseline entries were invalidated by a post-baseline rename
 * migration (commit a7c091a7 `digest→change-reports`; the bid→procurement
 * sweep). The baseline still names the OLD interface/file; the codemod's
 * `findSchemaConstant` resolves `${currentName}Schema` and the type-drift
 * detector reports the CURRENT name. To keep every entry MECHANISABLE and
 * to stop `type-drift-detect --ci` reporting the renamed interfaces as
 * "new fetcher-only" drift, we author the schema under the CURRENT name
 * and (in the baseline-rewrite step) correct the entry in place.
 *
 * Map: stale `${interface}@${file}` → current `{interface, file}`.
 */
export const RENAME_CORRECTIONS: Record<
  string,
  { interface: string; file: string }
> = {
  'DigestGenerateResponse@types/digest.ts': {
    interface: 'ChangeReportGenerateResponse',
    file: 'types/change-reports.ts',
  },
  'BidResponse@hooks/streaming/use-stream-coordination.ts': {
    interface: 'ProcurementResponse',
    file: 'hooks/streaming/use-stream-coordination.ts',
  },
  'ReadinessData@hooks/bid/use-bid-readiness.ts': {
    interface: 'ReadinessData',
    file: 'hooks/procurement/use-procurement-readiness.ts',
  },
};

export interface ResolvedTarget {
  /** The interface name the schema is authored under (current name). */
  name: string;
  /** Repo-relative file where the interface is currently declared. */
  file: string;
  /** The original baseline interface name (may differ when renamed). */
  baselineName: string;
  /** The original baseline file (may differ when moved). */
  baselineFile: string;
}

export function loadBaseline(): BaselineEntry[] {
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('[generate-response-schemas] baseline is not an array');
  }
  return parsed as BaselineEntry[];
}

export function resolveTargets(baseline: BaselineEntry[]): ResolvedTarget[] {
  return baseline.map((e) => {
    const key = `${e.interface}@${e.declaredAt.file}`;
    const correction = RENAME_CORRECTIONS[key];
    if (correction) {
      return {
        name: correction.interface,
        file: correction.file,
        baselineName: e.interface,
        baselineFile: e.declaredAt.file,
      };
    }
    return {
      name: e.interface,
      file: e.declaredAt.file,
      baselineName: e.interface,
      baselineFile: e.declaredAt.file,
    };
  });
}

// ── TS type → Zod expression mapping ─────────────────────────────────────────

/**
 * Render a Zod expression for a resolved ts-morph `Type`. Errs PERMISSIVE:
 * any shape we cannot confidently mirror collapses to `z.unknown()`.
 *
 * `depth` guards against runaway recursion through self-referential or very
 * deep types — beyond the cap we collapse to `z.unknown()`.
 */
export function typeToZod(type: Type, declNode: Node, depth: number): string {
  if (depth > 6) return 'z.unknown()';

  // ── Union handling (covers `T | null`, `T | undefined`, literal unions) ──
  if (type.isUnion()) {
    const parts = type.getUnionTypes();
    const hasNull = parts.some((p) => p.isNull());
    const hasUndefined = parts.some((p) => p.isUndefined());
    const nonNullish = parts.filter((p) => !p.isNull() && !p.isUndefined());

    // boolean is represented internally as `true | false` — collapse it.
    if (
      nonNullish.length === 2 &&
      nonNullish.every((p) => p.isBooleanLiteral())
    ) {
      let expr = 'z.boolean()';
      if (hasNull) expr += '.nullable()';
      if (hasUndefined) expr += '.optional()';
      return expr;
    }

    // String-literal union → z.enum / z.union(z.literal(...)).
    if (nonNullish.length > 0 && nonNullish.every((p) => p.isStringLiteral())) {
      const literals = nonNullish.map((p) =>
        JSON.stringify(p.getLiteralValue() as string),
      );
      let expr =
        literals.length === 1
          ? `z.literal(${literals[0]})`
          : `z.enum([${literals.join(', ')}])`;
      if (hasNull) expr += '.nullable()';
      if (hasUndefined) expr += '.optional()';
      return expr;
    }

    if (nonNullish.length === 1) {
      let expr = typeToZod(nonNullish[0], declNode, depth + 1);
      if (hasNull) expr += '.nullable()';
      if (hasUndefined) expr += '.optional()';
      return expr;
    }

    // Heterogeneous union we can't faithfully narrow → permissive.
    let expr = 'z.unknown()';
    if (hasNull && nonNullish.length === 0) expr = 'z.null()';
    return expr;
  }

  // ── Primitives ──
  if (type.isString()) return 'z.string()';
  if (type.isNumber()) return 'z.number()';
  if (type.isBoolean()) return 'z.boolean()';
  if (type.isStringLiteral())
    return `z.literal(${JSON.stringify(type.getLiteralValue() as string)})`;
  if (type.isNumberLiteral())
    return `z.literal(${type.getLiteralValue() as number})`;
  if (type.isBooleanLiteral()) return 'z.boolean()';
  if (type.isNull()) return 'z.null()';
  if (type.isUndefined()) return 'z.undefined()';
  if (type.isAny() || type.isUnknown()) return 'z.unknown()';

  // ── Arrays (`T[]`, `ReadonlyArray<T>`, `Array<T>`) ──
  if (type.isArray()) {
    const el = type.getArrayElementType();
    if (!el) return 'z.array(z.unknown())';
    return `z.array(${typeToZod(el, declNode, depth + 1)})`;
  }
  const roArray = readonlyArrayElement(type);
  if (roArray) {
    return `z.array(${typeToZod(roArray, declNode, depth + 1)})`;
  }

  // ── Object types ──
  if (type.isObject()) {
    // Record<K, V> / index-signature-driven map → z.record.
    const stringIndex = type.getStringIndexType();
    const props = type.getProperties();
    if (stringIndex && props.length === 0) {
      return `z.record(z.string(), ${typeToZod(stringIndex, declNode, depth + 1)})`;
    }
    if (props.length > 0) {
      const fields = props
        .map((p) => propToZodField(p, declNode, depth + 1))
        .filter((f): f is string => f !== null);
      if (fields.length === 0) return 'z.object({}).loose()';
      const body = fields.join(',\n');
      // Index signature alongside named props → still permissive via .loose().
      return `z.object({\n${body}\n}).loose()`;
    }
    // Empty object / opaque ref → permissive.
    return 'z.object({}).loose()';
  }

  // Tuple, intersection, generic-instantiation we can't map → permissive.
  return 'z.unknown()';
}

/** Render a single `key: <zod>` object field, honouring optionality. */
function propToZodField(
  prop: TsSymbol,
  declNode: Node,
  depth: number,
): string | null {
  const name = prop.getName();
  const propDecl = prop.getValueDeclaration() ?? prop.getDeclarations()[0];
  const node = propDecl ?? declNode;
  const propType = prop.getTypeAtLocation(node);

  let zod = typeToZod(propType, node, depth);

  // Optional member (`foo?:`) — ts-morph marks via the optional flag.
  const optional = prop.isOptional();
  if (optional && !zod.endsWith('.optional()')) {
    zod += '.optional()';
  }

  const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? name
    : JSON.stringify(name);
  return `  ${key}: ${zod}`;
}

/** Detect `ReadonlyArray<T>` / `readonly T[]` and return the element type. */
function readonlyArrayElement(type: Type): Type | null {
  const sym = type.getSymbol() ?? type.getAliasSymbol();
  const name = sym?.getName();
  if (name === 'ReadonlyArray') {
    const args = type.getTypeArguments();
    if (args.length === 1) return args[0];
  }
  return null;
}

// ── Schema emission ──────────────────────────────────────────────────────────

export interface GeneratedSchema {
  name: string;
  constName: string;
  source: string;
  zodExpr: string;
}

/**
 * Build the ts-morph project once and emit one `${name}Schema` const per
 * resolved target. Throws (caller surfaces) if a target's interface cannot
 * be located — that would mean a genuinely-dead baseline entry the generator
 * cannot mechanise.
 */
export function generateSchemas(targets: ResolvedTarget[]): {
  generated: GeneratedSchema[];
  unresolved: ResolvedTarget[];
} {
  const project = new Project({
    tsConfigFilePath: TSCONFIG_PATH,
    skipAddingFilesFromTsConfig: false,
  });

  const generated: GeneratedSchema[] = [];
  const unresolved: ResolvedTarget[] = [];

  for (const target of targets) {
    const sf = project.getSourceFile(resolve(REPO_ROOT, target.file));
    if (!sf) {
      unresolved.push(target);
      continue;
    }
    const iface = sf.getInterface(target.name) ?? sf.getTypeAlias(target.name);
    if (!iface) {
      unresolved.push(target);
      continue;
    }

    const type = iface.getType();
    const zodExpr = typeToZod(type, iface as unknown as Node, 0);

    generated.push({
      name: target.name,
      constName: `${target.name}Schema`,
      source: target.file,
      zodExpr,
    });
  }

  return { generated, unresolved };
}

/** Render the full managed block (markers + all consts). */
export function renderBlock(generated: GeneratedSchema[]): string {
  const consts = generated
    .map((g) => {
      return (
        `/** R-WP17 ResponseSchema for \`${g.name}\` (${g.source}). ` +
        `Generated; permissive per AC-8. */\n` +
        `export const ${g.constName} = ${g.zodExpr};`
      );
    })
    .join('\n\n');

  return `${BLOCK_BEGIN}\n//\n// ${generated.length} R-WP17 response-schema constants. Each validates the\n// matching route handler's return payload (AC-8) and is resolved by\n// Source-A inference via the \`${'$'}{interface}Schema\` name convention.\n//\n\n${consts}\n\n${BLOCK_END}`;
}

/** Replace (or append) the managed block inside schemas.ts source text. */
export function spliceBlock(schemasSource: string, block: string): string {
  const beginIdx = schemasSource.indexOf(BLOCK_BEGIN);
  const endMarkerIdx = schemasSource.indexOf(BLOCK_END);
  if (beginIdx !== -1 && endMarkerIdx !== -1) {
    const before = schemasSource.slice(0, beginIdx);
    const after = schemasSource.slice(endMarkerIdx + BLOCK_END.length);
    return `${before}${block}${after}`;
  }
  // Append with a leading separator.
  const trimmed = schemasSource.replace(/\s+$/, '');
  return `${trimmed}\n\n${block}\n`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main(): void {
  const write = process.argv.includes('--write');
  const baseline = loadBaseline();
  const targets = resolveTargets(baseline);
  const { generated, unresolved } = generateSchemas(targets);

  if (unresolved.length > 0) {
    process.stderr.write(
      `[generate-response-schemas] ${unresolved.length} unresolved target(s):\n` +
        unresolved.map((u) => `  - ${u.name} @ ${u.file}`).join('\n') +
        '\n',
    );
  }

  const block = renderBlock(generated);

  if (write) {
    const src = readFileSync(SCHEMAS_PATH, 'utf8');
    writeFileSync(SCHEMAS_PATH, spliceBlock(src, block), 'utf8');
    process.stdout.write(
      `[generate-response-schemas] wrote ${generated.length} schema const(s) to ${SCHEMAS_PATH}\n`,
    );
  } else {
    process.stdout.write(block + '\n');
  }
}

if (import.meta.main) {
  main();
}
