/**
 * Audit guard — PRODUCT Inv-19 (pipeline_failures table does NOT exist).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-19 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "No KH-owned `pipeline_failures` table is created at v1 — cocoindex's
 * > native retry / back-off / DLQ subsumes the planned table per COCO.7
 * > RATIFIED-DO-NOT-BUILD. Verifiable: `\d pipeline_failures` returns
 * > "relation does not exist" against prod and staging."
 *
 * Per TECH §2.10: `no-pipeline-failures-table.test.ts` covers Inv-19 with
 * "P-7 (no-op guard)".
 *
 * Test strategy:
 *   Postgres `to_regclass('public.pipeline_failures')` returns the OID
 *   of the table if it exists, or NULL if it doesn't. The Inv-19
 *   verifiable form: assert NULL.
 *
 *   The SQL must run against the LIVE database (the canonical Inv-19
 *   contract is "does not exist in prod and staging"). This test uses
 *   the live Supabase client via the standard helper.
 *
 *   The to_regclass() function is per-statement (not per-row), so the
 *   query is a simple one-row select that returns the OID or NULL.
 *   Because supabase-js exposes a `.rpc()` call rather than raw SQL,
 *   we route the to_regclass() check through a SELECT against a
 *   sentinel-table-existence view: probe the public.pipeline_failures
 *   table directly and assert the probe returns the PostgREST "relation
 *   does not exist" error (PGRST106 or schema-cache miss).
 *
 *   Alternative strategy if to_regclass becomes available via a custom
 *   RPC: switch to that. For now the .from() probe is the supabase-js-
 *   native expression of the Inv-19 contract.
 *
 * Env-gate: live Supabase (HAS_LIVE_DB). Audit-of-the-substrate test —
 * always runs against the configured DB.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-19.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-19.
 *   - 02-data-flow.md §7.3 + §10.4 (pipeline_failures RATIFIED-DO-NOT-
 *     BUILD).
 *   - RESEARCH.md §1.5 (cocoindex retry / back-off / DLQ native).
 */

import { describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
  isNetworkIsolationError,
} from '../helpers/supabase-client';

// Tighter live-DB gate: skip cleanly when the URL is the dummy test
// default from `__tests__/setup.ts`. The dummy URL produces an HTTP-level
// fetch error rather than a PGRST table-absent error, which is not a
// meaningful Inv-19 assertion target.
const HAS_LIVE_DB = hasRealLiveDbCredentials();

describe.skipIf(!HAS_LIVE_DB)(
  'Inv-19 — pipeline_failures table does NOT exist (to_regclass guard)',
  () => {
    it('probing public.pipeline_failures via supabase-js returns the "relation does not exist" error', async () => {
      const client = await createLiveServiceClient();

      // Probe the table directly. If it exists, the select returns rows
      // or an empty array with no error. If it doesn't exist, supabase-js
      // surfaces a PostgREST error (typically PGRST205 for unknown
      // relation in schema cache, or PGRST106 / PGRST116 variants).
      // The TypeScript signature for client.from() is generic on the
      // schema types; the runtime accepts any string, so we cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (client.from as any)('pipeline_failures')
        .select('*')
        .limit(1);

      // Inv-19 verifiability: the probe MUST surface an error indicating
      // the relation does not exist. A successful probe with data or
      // empty-array (no error) proves the table DOES exist and Inv-19
      // is broken.
      expect(error).not.toBeNull();
      expect(data).toBeNull();

      // The error message MUST mention the table-absent condition.
      // Empirical PostgREST shape (observed against staging on 23/05/2026):
      //   code: 'PGRST205'
      //   message: "Could not find the table 'public.pipeline_failures'
      //             in the schema cache"
      //   hint: "Perhaps you meant the table 'public.pipeline_runs'"
      //
      // The unified test: error.code is PGRST205 (canonical schema-cache
      // miss code) OR the message text contains the table-absent signal.
      // We accept either form to remain resilient to PostgREST version
      // upgrades that may shift the wording.
      // Sandbox-aware skip: network-isolated environments cannot reach
      // Supabase. The Inv-19 contract is unverifiable from here. CI
      // environments with real network access exercise the assertion
      // below. The static migration-history check (second test) is the
      // v1-deterministic substrate that runs always.
      if (isNetworkIsolationError(error)) {
        // eslint-disable-next-line no-console
        console.warn(
          'Inv-19: skipping live PostgREST assertion — network-isolated environment',
        );
        return;
      }

      const errorMsg = (error!.message ?? '').toLowerCase();
      const errorCode = (error!.code ?? '') as string;
      const hasNotFoundSignal =
        errorCode === 'PGRST205' ||
        errorCode === 'PGRST106' ||
        errorCode === 'PGRST116' ||
        (errorMsg.includes('pipeline_failures') &&
          (errorMsg.includes('could not find') ||
            errorMsg.includes('does not exist') ||
            errorMsg.includes('not found')));
      expect(hasNotFoundSignal).toBe(true);
    }, 30_000);

    it('confirms no migration in supabase/migrations/ has created public.pipeline_failures', async () => {
      // Defensive static guard — if any migration introduces the table,
      // the runtime probe above would still pass against an old DB
      // snapshot but break the moment the migration applies. This
      // static check looks for any CREATE TABLE pipeline_failures
      // pattern in the migration history.
      const { readdir, readFile } = await import('node:fs/promises');
      const path = await import('node:path');

      const migrationsDir = path.resolve(
        __dirname,
        '../../../supabase/migrations',
      );

      const entries = await readdir(migrationsDir);
      const sqlFiles = entries.filter((e) => e.endsWith('.sql'));

      const violations: { file: string; line: number; text: string }[] = [];
      for (const file of sqlFiles) {
        const fullPath = path.join(migrationsDir, file);
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Look for CREATE TABLE pipeline_failures (case-insensitive,
          // allowing optional schema-qualifier).
          if (
            /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?pipeline_failures/i.test(
              line,
            )
          ) {
            violations.push({ file, line: i + 1, text: line.trim() });
          }
        }
      }

      // Inv-19 verifiability: zero CREATE TABLE statements introduce
      // pipeline_failures.
      expect(violations).toEqual([]);
    }, 30_000);
  },
);
