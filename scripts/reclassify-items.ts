#!/usr/bin/env bun
/**
 * reclassify-items.ts — Targeted re-classify of specific content items.
 *
 * Minimal wrapper around `classifyContent({ force: true, validate: false })`
 * for a comma-separated list of item UUIDs (or prefixes). Designed for
 * backfilling the 2 residual ISO 27001 q_a_pairs that S192's SQL backfill
 * missed (§1.16 spec §13.2 WP2).
 *
 * Distinct from `scripts/backfill-classify-content-items.ts` which is
 * workspace-scoped and does not accept `--item-ids`.
 *
 * Usage:
 *   bun run scripts/reclassify-items.ts --item-ids=<uuid-or-prefix>,<uuid-or-prefix>
 *
 * NOTE: Run with dangerouslyDisableSandbox: true — Bun fetch hangs behind
 * the sandbox SOCKS proxy on Supabase writes (memory
 * `feedback_sandbox_proxy_breaks_python_sdk` applies to the TS side too).
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { classifyContent } from '@/lib/ai/classify';

const PIPELINE_SERVICE_ACCOUNT_USER_ID =
  'a0000000-0000-4000-8000-000000000001';

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* missing file ok */
  }
}

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

function parseItemIds(): string[] {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--item-ids=')) {
      return arg
        .slice('--item-ids='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  console.error('Usage: reclassify-items.ts --item-ids=<uuid-or-prefix>,...');
  process.exit(2);
}

async function resolveIds(
  supabase: ReturnType<typeof createClient<Database>>,
  prefixes: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id');
  if (error) {
    throw new Error(`Failed to fetch content_items: ${error.message}`);
  }
  const ids: string[] = [];
  for (const p of prefixes) {
    const match = (data ?? []).find((r) => r.id.startsWith(p));
    if (!match) {
      console.error(`  no content_item match for prefix: ${p}`);
      continue;
    }
    ids.push(match.id);
  }
  return ids;
}

async function fetchHolderMetadata(
  supabase: ReturnType<typeof createClient<Database>>,
  itemId: string,
): Promise<
  Array<{ canonical_name: string; metadata: unknown }>
> {
  const { data, error } = await supabase
    .from('entity_mentions')
    .select('canonical_name, metadata')
    .eq('content_item_id', itemId)
    .eq('entity_type', 'certification');
  if (error) {
    console.error(`  [warn] metadata fetch failed: ${error.message}`);
    return [];
  }
  return data ?? [];
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(2);
  }
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // SAFETY GUARD: if NEXT_PUBLIC_CLIENT_ID is not set, BRANDING falls
  // back to default ("Knowledge Hub"), which would corrupt holder
  // derivation on every cert. Fail fast — same guard as eval-holder-
  // rule-ts.ts. See S196 handoff for incident context.
  const { BRANDING } = await import('@/lib/client-config');
  if (BRANDING.organisationName === 'Knowledge Hub') {
    console.error(
      `[reclassify] BRANDING.organisationName = "Knowledge Hub" (default ` +
        `fallback). This means NEXT_PUBLIC_CLIENT_ID is not set. Running ` +
        `classifyContent would derive holder metadata against the wrong ` +
        `client org. Set NEXT_PUBLIC_CLIENT_ID=example-client in your shell or ` +
        `.env.local and retry.`,
    );
    process.exit(2);
  }

  const prefixes = parseItemIds();
  const ids = await resolveIds(supabase, prefixes);
  console.error(`Resolved ${ids.length} item(s) for re-classify.`);

  for (const itemId of ids) {
    console.error(`\n[reclassify] ${itemId}`);
    try {
      await classifyContent({
        supabase,
        itemId,
        force: true,
        userId: PIPELINE_SERVICE_ACCOUNT_USER_ID,
        validate: false,
      });
    } catch (err) {
      console.error(
        `  [error] classify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const certMentions = await fetchHolderMetadata(supabase, itemId);
    for (const m of certMentions) {
      const md = (m.metadata ?? {}) as Record<string, unknown>;
      const holder = md.holder ?? '(unset)';
      const supplier = md.supplier_name ?? '';
      console.error(
        `  cert: ${m.canonical_name}  holder=${holder}${supplier ? `  supplier=${supplier}` : ''}`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
