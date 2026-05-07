/**
 * OPS-64 guard: prevent RLS policies from reading session-set `app.*` GUCs
 * as identity claims.
 *
 * Background:
 *   `public.set_config(setting text, value text, is_local boolean)` is a
 *   Supabase-managed SECURITY DEFINER SQL shim wrapping
 *   `pg_catalog.set_config`. It is granted to anon + authenticated +
 *   service_role + PUBLIC by Supabase platform defaults — exposed to anon
 *   by design so PostgREST can set `request.jwt.*` GUCs during anonymous
 *   read paths (S22 OPS-43 spec §AC-5; carved out in
 *   `scripts/check-revoke-guard.ts:178-186`).
 *
 *   The carve-out is provably safe IFF no RLS policy reads any
 *   `current_setting('app.X')` value as an identity / authorisation claim,
 *   because that pattern would let an anon caller set the GUC themselves
 *   via `set_config('app.user_id', '<victim-uuid>', true)` and then bypass
 *   the policy on the next query within the same transaction.
 *
 *   kh-prod-readiness-S38 W2 OPS-64 investigation confirmed (07/05/2026)
 *   that ZERO RLS policies in the live database read any `app.*` GUC. The
 *   only consumer of any `app.*` GUC is the `snapshot_bid_response_history()`
 *   trigger reading `app.change_reason` for audit-trail capture, which is
 *   reached only via admin/editor-gated `UPDATE bid_responses` and so does
 *   NOT activate the GUC-injection-bypass attack vector.
 *
 *   This guard locks in that property: any future migration adding a
 *   CREATE POLICY containing `current_setting('app.X')` MUST also lift
 *   the privilege grant on `public.set_config` from anon (and the
 *   `INTENTIONAL_ANON_ALLOW_LIST` entry) — the test fails CI to force
 *   a paired-change conversation.
 *
 * What this test enforces:
 *   For every migration file under `supabase/migrations/`, no
 *   `CREATE POLICY ... ;` block (multi-line tolerated) may contain a
 *   `current_setting('app.X', ...)` read. Function bodies (AS $$ ... $$)
 *   are stripped first so the audit-trail trigger and other helper
 *   functions are not flagged.
 *
 * What this test does NOT enforce:
 *   - That trigger functions / SECDEF helpers don't read `app.*` GUCs.
 *     Triggers fire under owner privileges (postgres) and reach the GUC
 *     only via legitimate write paths gated by RLS upstream, so the
 *     attack vector is the policy-read pattern specifically.
 *   - That the `set_config` ACL is unchanged. The revoke-guard cron
 *     (`scripts/check-revoke-guard.ts`) covers that surface.
 *   - Live `pg_policies` state. A separate integration test could check
 *     the live DB, but the file scan catches authorship — which is the
 *     right enforcement point.
 *
 * Escape hatch:
 *   If a migration legitimately needs to bypass this guard (it should
 *   not — instead, lift the privilege grant on `public.set_config` from
 *   anon + authenticated and replace the audit-trail mechanism), add the
 *   literal comment `-- OPS-64-GUARD-EXEMPT: <reason>` somewhere in the
 *   file. The test surfaces these so they can be reviewed during code
 *   review.
 *
 * Why a vitest test rather than ESLint:
 *   Migration files are SQL, not TypeScript. ESLint cannot reach them.
 *   Running this in the existing `bun run test` suite ensures it gates
 *   every commit and runs in CI alongside the rest of the test suite.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

const EXEMPTION_MARKER = 'OPS-64-GUARD-EXEMPT';

interface MigrationFile {
  name: string;
  path: string;
  content: string;
}

function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  return files.map((name) => {
    const path = resolve(MIGRATIONS_DIR, name);
    return { name, path, content: readFileSync(path, 'utf-8') };
  });
}

function stripCommentsAndFunctionBodies(content: string): string {
  const noComments = content
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf('--');
      return commentIdx === -1 ? line : line.slice(0, commentIdx);
    })
    .join('\n');
  return noComments.replace(/AS\s+\$\$[\s\S]*?\$\$;/gi, '');
}

function extractCreatePolicyBlocks(content: string): string[] {
  const stripped = stripCommentsAndFunctionBodies(content);
  const blocks: string[] = [];
  const regex = /CREATE\s+POLICY[\s\S]*?;\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

function policyReadsAppGuc(policyBlock: string): boolean {
  return /current_setting\s*\(\s*['"]app\./i.test(policyBlock);
}

describe('OPS-64 guard — RLS policies must not read session-set app.* GUCs', () => {
  const migrations = loadMigrations();

  it('migration directory is non-empty (sanity check)', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it("no CREATE POLICY block reads current_setting('app.X')", () => {
    const violations: string[] = [];

    for (const m of migrations) {
      if (m.content.includes(EXEMPTION_MARKER)) continue;

      const policyBlocks = extractCreatePolicyBlocks(m.content);
      for (const block of policyBlocks) {
        if (policyReadsAppGuc(block)) {
          const headerMatch = block.match(
            /CREATE\s+POLICY\s+([^\s]+)\s+ON\s+([^\s]+)/i,
          );
          const header = headerMatch
            ? `${headerMatch[1]} ON ${headerMatch[2]}`
            : '<unparsable header>';
          violations.push(`  - ${m.name}: ${header}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `OPS-64 guard failure — RLS policies must not read session-set ` +
          `\`app.*\` GUCs as identity / authorisation claims. ` +
          `\`public.set_config\` is granted to anon by Supabase ` +
          `platform defaults (S22 OPS-43 spec §AC-5 carve-out), so any ` +
          `policy reading \`current_setting('app.X')\` becomes a GUC-` +
          `injection bypass: anon can call ` +
          `\`set_config('app.X', '<value>', true)\` and circumvent the ` +
          `policy on the next query in the transaction.\n\n` +
          `Violations:\n${violations.join('\n')}\n\n` +
          `Required paired change if you genuinely need this pattern:\n` +
          `  1. Lift privileges on public.set_config(text,text,boolean) from PUBLIC, anon, authenticated.\n` +
          `  2. Remove the entry from INTENTIONAL_ANON_ALLOW_LIST in ` +
          `scripts/check-revoke-guard.ts:178-186.\n` +
          `  3. Refactor any non-policy callers (e.g. ` +
          `app/api/bids/[id]/responses/[rId]/route.ts:250 audit-trail ` +
          `trigger pattern) so they do not depend on session-set GUCs.\n` +
          `  4. Document closure in SCHEMA-QUICK-REFERENCE.md §32.1.x.\n\n` +
          `Investigation reference: kh-prod-readiness-S38 W2 OPS-64.\n` +
          `Escape hatch: add \`-- ${EXEMPTION_MARKER}: <reason>\` to the ` +
          `migration file (review-gated).`,
      );
    }
  });

  it('exemptions are surfaced for code review (informational)', () => {
    const exemptions = migrations.filter((m) =>
      m.content.includes(EXEMPTION_MARKER),
    );
    if (exemptions.length > 0) {
      console.log(
        `\nOPS-64 guard: ${exemptions.length} migration(s) marked ${EXEMPTION_MARKER}:\n` +
          exemptions.map((e) => `  - ${e.name}`).join('\n'),
      );
    }
    expect(exemptions.length).toBeLessThanOrEqual(2);
  });
});
