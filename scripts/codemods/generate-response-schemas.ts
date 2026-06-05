/**
 * `generate-response-schemas.ts` — one-shot dev generator for the
 * R-WP17 ResponseSchema constants consumed by the OPS-T1 codemod's
 * Source-A inference (`scripts/codemods/inference-source-a.ts` →
 * `findSchemaConstant`).
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5, AC-8
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md §3.A
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
 * STRICTNESS (INV-S, TECH §3.1a — supersedes the ID-32.20 permissive
 * model): the emitted schema validates the route handler's RETURN payload
 * at runtime via the pass-through `defineRoute(<Schema>, handler)` wrapper
 * (ID-32.25), which validates the 2xx body and passes status/headers
 * through. Under that contract a strict schema NO LONGER regresses AC-8 —
 * so the generator derives strictness from the REAL source interfaces:
 *   - plain object literal        → bare `z.object({...})` (zod-4 default;
 *     STRIPS additive wire fields but REJECTS a renamed/removed/retyped
 *     declared field — the drift-catching sweet spot). NEVER `.loose()`,
 *     NEVER `z.strictObject` (the latter 500s on legitimately-added fields).
 *   - string-literal union        → `z.enum([...])` / `z.literal(...)`
 *   - genuine `[k: string]: T` index signature → `.loose()`, ALLOW-LISTED
 *   - opaque `Json`/`unknown`/un-narrowable external → `z.unknown()`,
 *     ALLOW-LISTED
 *   - optional members            → `.optional()`
 *   - `T | null` members          → `.nullable()`
 *
 * Every `.loose()` / `z.unknown()` is recorded on a machine-checkable
 * `// ALLOW:` manifest emitted alongside the schemas, so the INV-S static
 * guard (Subtask {32.27} / r-wp17-schema-strictness.test.ts) can assert no
 * un-justified permissive token survives. Cycle-detection (`WalkCtx.visited`)
 * lets deep-but-finite structures resolve fully — eliminating the old
 * depth-cap `z.unknown()` artifacts.
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
const BASELINE_PATH = resolve(REPO_ROOT, '.type-drift-baseline.json');
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

// ── TS type → Zod expression mapping (INV-S, TECH §3.1a) ─────────────────────

/**
 * A single justified `.loose()` / `z.unknown()` exception, collected during
 * the walk and rendered into the machine-checkable `// ALLOW:` manifest so the
 * INV-S static guard (Subtask {32.27}) can assert every permissive token is
 * grounded in a real source property.
 */
export interface AllowEntry {
  /** Which permissive construct this entry justifies. */
  kind: 'loose' | 'unknown';
  /** `<Interface>.<dotted.prop.path>` the construct was emitted at. */
  path: string;
  /** Why it is permitted: a real index signature, opaque `Json`/`unknown`, or
   *  an un-narrowable external/generic type. */
  justification: 'index-signature' | 'Json' | 'unknown' | 'external';
  /** Free-text detail (e.g. the index-signature value type) for the manifest. */
  detail: string;
}

/**
 * Walk context threaded through `typeToZod`. Replaces the old bare numeric
 * depth cap with cycle-detection (`visited`) so genuinely-deep-but-finite
 * structures resolve fully (eliminating the depth-cap `z.unknown()` artifacts
 * INV-S bans) while self-referential types still terminate.
 */
export interface WalkCtx {
  /** Dotted property path from the root interface, for allow-list entries. */
  path: string;
  /** ts-morph `Type` identities already on the current walk stack (cycle break). */
  visited: Set<Type>;
  /** Collected justified exceptions (mutated in place). */
  allow: AllowEntry[];
  /** Backstop depth in case `visited` misses a pathological case. */
  depth: number;
}

/** Push a justified `z.unknown()` exception onto the allow-list and return the token. */
function permitUnknown(
  ctx: WalkCtx,
  justification: AllowEntry['justification'],
  detail: string,
): string {
  ctx.allow.push({ kind: 'unknown', path: ctx.path, justification, detail });
  return 'z.unknown()';
}

/**
 * Render a Zod expression for a resolved ts-morph `Type`, deriving strictness
 * from the REAL source shape per INV-S (TECH §3.1a):
 *
 *   - plain object literal  → bare `z.object({...})` (zod-4 default; strips
 *     additive wire fields, REJECTS a renamed/removed/retyped declared field —
 *     the drift-catching sweet spot). NEVER `.loose()` and NEVER `z.strictObject`.
 *   - object with a genuine `[k: string]: T` index signature → `.loose()`,
 *     recorded on the allow-list.
 *   - genuinely-opaque `Json`/`unknown`/un-narrowable external type → `z.unknown()`,
 *     recorded on the allow-list.
 *   - string-literal union → `z.enum`/`z.literal`; `T | null` → `.nullable()`;
 *     optional → `.optional()`.
 *
 * Cycle-detection via `ctx.visited` lets deep-but-finite structures resolve
 * fully; the `ctx.depth` backstop guards a pathological miss.
 */
export function typeToZod(type: Type, declNode: Node, ctx: WalkCtx): string {
  if (ctx.depth > 25)
    return permitUnknown(ctx, 'external', 'recursion-backstop');

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
      let expr = typeToZod(nonNullish[0], declNode, {
        ...ctx,
        depth: ctx.depth + 1,
      });
      if (hasNull) expr += '.nullable()';
      if (hasUndefined) expr += '.optional()';
      return expr;
    }

    // `null` alone → z.null(); a heterogeneous union we cannot faithfully
    // narrow is a genuinely-opaque member → allow-listed z.unknown(). The
    // Supabase `Json` alias is exactly such a structural recursive union —
    // label it precisely so the manifest is self-documenting.
    if (hasNull && nonNullish.length === 0) return 'z.null()';
    if (isSupabaseJson(type)) {
      return permitUnknown(ctx, 'Json', 'supabase-Json');
    }
    return permitUnknown(ctx, 'external', 'heterogeneous-union');
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
  // `Json` (Supabase DB-generated) resolves to `any`; a bare `unknown` member
  // is genuinely opaque. Both are PERMITTED z.unknown() per INV-S, allow-listed.
  if (type.isAny()) return permitUnknown(ctx, 'Json', 'resolves-to-any');
  if (type.isUnknown()) return permitUnknown(ctx, 'unknown', 'unknown');

  // ── Arrays (`T[]`, `ReadonlyArray<T>`, `Array<T>`) ──
  if (type.isArray()) {
    const el = type.getArrayElementType();
    if (!el)
      return `z.array(${permitUnknown(ctx, 'external', 'array-no-element')})`;
    return `z.array(${typeToZod(el, declNode, { ...ctx, path: `${ctx.path}[]`, depth: ctx.depth + 1 })})`;
  }
  const roArray = readonlyArrayElement(type);
  if (roArray) {
    return `z.array(${typeToZod(roArray, declNode, { ...ctx, path: `${ctx.path}[]`, depth: ctx.depth + 1 })})`;
  }

  // ── Object types ──
  if (type.isObject()) {
    // Cycle break: a self-referential object type already on the stack would
    // recurse forever. Emit an allow-listed z.unknown() to terminate.
    if (ctx.visited.has(type)) {
      return permitUnknown(ctx, 'external', 'recursive-type');
    }
    const visited = new Set(ctx.visited).add(type);

    const stringIndex = type.getStringIndexType();
    const props = type.getProperties();

    // Pure map (`Record<K, V>` / index-signature only) → z.record.
    if (stringIndex && props.length === 0) {
      return `z.record(z.string(), ${typeToZod(stringIndex, declNode, { ...ctx, path: `${ctx.path}{}`, visited, depth: ctx.depth + 1 })})`;
    }

    if (props.length > 0) {
      const fields = props
        .map((p) =>
          propToZodField(p, declNode, {
            ...ctx,
            visited,
            depth: ctx.depth + 1,
          }),
        )
        .filter((f): f is string => f !== null);
      const body = fields.join(',\n');
      const objectExpr =
        fields.length === 0 ? 'z.object({})' : `z.object({\n${body}\n})`;

      // INV-S: bare z.object is the strict default. A GENUINE `[k: string]: T`
      // index signature ALONGSIDE named props is the only permitted `.loose()`
      // case (e.g. PipelineRunRow.progress) — allow-listed.
      if (stringIndex) {
        ctx.allow.push({
          kind: 'loose',
          path: ctx.path,
          justification: 'index-signature',
          detail: `[k: string]: ${stringIndex.getText()}`,
        });
        return `${objectExpr}.loose()`;
      }
      return objectExpr;
    }

    // Empty / opaque object reference with no resolvable shape → opaque member.
    return permitUnknown(ctx, 'external', 'opaque-object-no-props');
  }

  // Tuple, intersection, generic-instantiation we can't map → opaque member.
  return permitUnknown(ctx, 'external', 'unmappable-type');
}

/** Render a single `key: <zod>` object field, honouring optionality. */
function propToZodField(
  prop: TsSymbol,
  declNode: Node,
  ctx: WalkCtx,
): string | null {
  const name = prop.getName();
  const propDecl = prop.getValueDeclaration() ?? prop.getDeclarations()[0];
  const node = propDecl ?? declNode;
  const propType = prop.getTypeAtLocation(node);

  let zod = typeToZod(propType, node, { ...ctx, path: `${ctx.path}.${name}` });

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

/**
 * Detect the Supabase DB-generated `Json` alias (a recursive structural union
 * `string | number | boolean | { [k]: Json } | Json[] | null`). Used to label
 * the allow-list entry precisely as an opaque `Json` member rather than a
 * generic `external` union.
 */
function isSupabaseJson(type: Type): boolean {
  const sym = type.getAliasSymbol() ?? type.getSymbol();
  if (sym?.getName() === 'Json') return true;
  // Fall back to checking the alias text — the alias prints as a `Json` import.
  return /\bJson\b/.test(type.getText());
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
  /** Justified `.loose()` / `z.unknown()` exceptions for this schema (INV-S). */
  allow: AllowEntry[];
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
    const allow: AllowEntry[] = [];
    const zodExpr = typeToZod(type, iface as unknown as Node, {
      path: target.name,
      visited: new Set<Type>(),
      allow,
      depth: 0,
    });

    generated.push({
      name: target.name,
      constName: `${target.name}Schema`,
      source: target.file,
      zodExpr,
      allow,
    });
  }

  return { generated, unresolved };
}

/**
 * Render one `// ALLOW:` manifest line per justified exception. The INV-S
 * static guard parses these and asserts there is exactly one entry per
 * `.loose()` / `z.unknown()` token in the generated code.
 *
 * Format (machine-checkable, TECH §3.1a allow-list mechanism):
 *   // ALLOW: .loose @ <Interface>.<path> — index-signature <detail>
 *   // ALLOW: z.unknown @ <Interface>.<path> — <Json|unknown|external> (<detail>)
 */
export function renderAllowManifest(generated: GeneratedSchema[]): string {
  const entries = generated.flatMap((g) => g.allow);
  if (entries.length === 0) {
    return '// ALLOW manifest: none — block is fully strict (no .loose()/z.unknown()).';
  }
  const lines = entries.map((e) => {
    const construct = e.kind === 'loose' ? '.loose' : 'z.unknown';
    return `// ALLOW: ${construct} @ ${e.path} — ${e.justification} (${e.detail})`;
  });
  return [
    '// ── INV-S allow-list manifest (TECH §3.1a) ──',
    '// Every .loose() and z.unknown() below is justified by a real source',
    '// property: a genuine [k: string]: T index signature, an opaque Json/DB',
    '// member, a bare `unknown`, or an un-narrowable external/generic type.',
    `// The INV-S static guard asserts one entry per permissive token (${entries.length}).`,
    ...lines,
  ].join('\n');
}

/** Render the full managed block (markers + allow-list manifest + all consts). */
export function renderBlock(generated: GeneratedSchema[]): string {
  const consts = generated
    .map((g) => {
      return (
        `/** R-WP17 ResponseSchema for \`${g.name}\` (${g.source}). ` +
        `Generated; strict per INV-S (TECH §3.1a). */\n` +
        `export const ${g.constName} = ${g.zodExpr};`
      );
    })
    .join('\n\n');

  const manifest = renderAllowManifest(generated);

  return `${BLOCK_BEGIN}\n//\n// ${generated.length} R-WP17 response-schema constants. Each validates the\n// matching route handler's return payload (AC-8) and is resolved by\n// Source-A inference via the \`${'$'}{interface}Schema\` name convention.\n//\n// Strictness derives from the REAL source interfaces (INV-S, TECH §3.1a):\n// bare z.object strips additive wire fields but REJECTS a renamed/removed/\n// retyped declared field. .loose()/z.unknown() appear ONLY where allow-listed.\n//\n\n${manifest}\n\n${consts}\n\n${BLOCK_END}`;
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
