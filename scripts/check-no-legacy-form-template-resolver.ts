#!/usr/bin/env bun
/**
 * ID-145 {145.7} — atomic-release guard: assert zero surviving references to
 * the retired `resolveOrMintFormTemplateId` TS resolver and the retired
 * `resolve_or_mint_form_template_id` RPC.
 *
 * TECH.md §2 M3 / §10 ("RPC-drop / TS-caller gap window"): {145.6}'s W1c
 * migration drops the `resolve_or_mint_form_template_id` Postgres function
 * (public + api). Its live TS caller, `resolveOrMintFormTemplateId`
 * (`lib/domains/procurement/resolve-form-template.ts`), is deleted in the
 * SAME merged tree by {145.7} — this gate is the PRIMARY guard that the two
 * changes never ship out of lockstep (a merge with the migration but without
 * the caller removal would 500 both question routes at runtime, PGRST202).
 *
 * PRECISE, not a blind substring search: matches CALL-shaped usage
 * (`resolveOrMintFormTemplateId(`), IMPORT-shaped usage
 * (`import { resolveOrMintFormTemplateId } from ...`), and RPC-call-shaped
 * usage (`.rpc('resolve_or_mint_form_template_id'`) — i.e. code that would
 * actually try to invoke the retired symbols. Deliberately does NOT flag a
 * comment that mentions either name in prose for historical/documentation
 * purposes (e.g. "the resolve_or_mint_form_template_id RPC is retired,
 * {145.7}") — this codebase's own convention is to explain removals by
 * naming what was removed, and TECH.md's own wording ("surviving...
 * references") is read here as live/functional references, not archaeology.
 *
 * Scope: git-tracked TS/TSX source, excluding `supabase/migrations/**`
 * (immutable historical DDL record — the migration that DROPS the RPC
 * necessarily still narrates its own removal) and
 * `supabase/types/database.types.ts` (generated; carries a stale
 * `resolve_or_mint_form_template_id` Functions entry until the Orchestrator's
 * post-push `bun run sync` type regen — expected, self-healing staleness, not
 * a live reference).
 *
 * Usage:  bun scripts/check-no-legacy-form-template-resolver.ts
 * Exit codes: 0 — clean; 1 — one or more live references found (reported on
 * stderr with file:line).
 */
import { execFileSync } from 'node:child_process';

interface Finding {
  file: string;
  line: number;
  text: string;
  matchedPattern: string;
}

const PATTERNS: { name: string; grepExpr: string }[] = [
  {
    name: 'call-shaped resolveOrMintFormTemplateId(...)',
    grepExpr: 'resolveOrMintFormTemplateId[[:space:]]*\\(',
  },
  {
    name: 'import-shaped resolveOrMintFormTemplateId',
    grepExpr: 'import[^;]*\\bresolveOrMintFormTemplateId\\b',
  },
  {
    name: "RPC-call-shaped .rpc('resolve_or_mint_form_template_id')",
    grepExpr: '\\.rpc\\([[:space:]]*[\'"]resolve_or_mint_form_template_id[\'"]',
  },
  {
    // Property/binding-shaped: `resolveOrMintFormTemplateId: <expr>` — covers
    // vi.mock() factory re-exports (e.g. `vi.mock('@/lib/domains/procurement/
    // resolve-form-template', () => ({ resolveOrMintFormTemplateId:
    // mockFn }))`) and plain object-literal usage.
    name: 'binding-shaped resolveOrMintFormTemplateId:',
    grepExpr: '\\bresolveOrMintFormTemplateId[[:space:]]*:',
  },
  {
    // The mock TARGET path itself — unambiguous once the module is deleted.
    name: "vi.mock('@/lib/domains/procurement/resolve-form-template')",
    grepExpr: 'resolve-form-template[\'"]',
  },
];

const EXCLUDE_PATHSPECS = [
  ':(exclude)supabase/migrations/**',
  ':(exclude)supabase/types/database.types.ts',
  // This gate's own source necessarily names the retired symbols in its
  // pattern definitions/doc comments — exclude self, else it always fails.
  ':(exclude)scripts/check-no-legacy-form-template-resolver.ts',
];

function gitGrep(grepExpr: string): Finding[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-nIE', grepExpr, '--', '*.ts', '*.tsx', ...EXCLUDE_PATHSPECS],
      { encoding: 'utf8' },
    );
    return out
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => {
        const firstColon = l.indexOf(':');
        const secondColon = l.indexOf(':', firstColon + 1);
        return {
          file: l.slice(0, firstColon),
          line: Number(l.slice(firstColon + 1, secondColon)),
          text: l.slice(secondColon + 1).trim(),
          matchedPattern: grepExpr,
        };
      });
  } catch (err) {
    // git grep exits 1 when there are zero matches (not an error condition
    // for this gate — it's the PASS state) and 2+ on a real error (bad
    // pathspec, not a git repo, etc.).
    const status = (err as { status?: number }).status;
    if (status === 1) return [];
    throw err;
  }
}

function main(): number {
  const allFindings: Finding[] = [];
  for (const pattern of PATTERNS) {
    allFindings.push(...gitGrep(pattern.grepExpr));
  }

  if (allFindings.length === 0) {
    console.log(
      'check-no-legacy-form-template-resolver: PASS — zero live references ' +
        'to resolveOrMintFormTemplateId / resolve_or_mint_form_template_id.',
    );
    return 0;
  }

  console.error(
    `check-no-legacy-form-template-resolver: FAIL — ${allFindings.length} ` +
      'live reference(s) to the retired resolver found.',
  );
  for (const f of allFindings) {
    console.error(`  ${f.file}:${f.line}: ${f.text}`);
  }
  console.error(
    '\nThe resolve_or_mint_form_template_id RPC + its TS resolver ' +
      '(lib/domains/procurement/resolve-form-template.ts) were retired at ' +
      'ID-145 {145.6}/{145.7} — the form-first re-architecture attaches ' +
      'questions to a KNOWN form_instance_id (the route [id]) directly. ' +
      'Remove the call site, or if this is a genuine new need, escalate — do ' +
      'not resurrect the dropped RPC.',
  );
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
