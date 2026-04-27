#!/usr/bin/env bun
/**
 * restore-eval-corrupted-items.ts — S196 rollback helper.
 *
 * S196 eval run (2026-04-24) ran LOCALLY without `NEXT_PUBLIC_CLIENT_ID=example-client`
 * set, so `BRANDING.organisationName` defaulted to "Knowledge Hub" instead
 * of "Example Client Ltd". Every cert with a `holds` source of the actual
 * client org was mis-derived as `holder: 'supplier'`. The eval was killed
 * after processing 18 items (items 1-17 complete, item 18 possibly partial).
 *
 * This script restores entity_mentions + holds_relationships for the 18
 * affected items from the pre-eval snapshot at
 * `docs/audits/ts-eval-preflight-2026-04-25.json`.
 *
 * NOTE: Non-holds entity_relationships for the affected items are NOT
 * restored because the snapshot only captured holds rels. This is minor
 * data loss — acceptable because the cert dashboard keys on
 * entity_mentions.metadata, not on non-holds rels.
 *
 * Run with dangerouslyDisableSandbox: true.
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ─────────────────────────────────
// Env loading (same pattern as eval)
// ─────────────────────────────────

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equalsIdx = line.indexOf('=');
      if (equalsIdx === -1) continue;
      const key = line.slice(0, equalsIdx).trim();
      let value = line.slice(equalsIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // silent — file may not exist
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

// Restore the full eval target set. First eval run (wrong BRANDING)
// overwrote items 1-18; second retry run (correct BRANDING but eval
// design is non-deterministic) overwrote items 1-17/18 again + some
// new ones. Safer to restore ALL 52 items the snapshot captured —
// covers both runs, is idempotent, returns prod to pre-eval baseline.
const CORRUPTED_ITEM_IDS = 'ALL' as const;

const SNAPSHOT_PATH = 'docs/audits/ts-eval-preflight-2026-04-25.json';

interface MentionRow {
  id: string;
  content_item_id: string;
  entity_type: string;
  entity_name: string;
  canonical_name: string;
  confidence: number;
  context_snippet: string | null;
  metadata?: Record<string, unknown> | null;
}

interface HoldsRelRow {
  id: string;
  source_item_id: string;
  source_entity: string;
  relationship_type: string;
  target_entity: string;
  confidence?: number;
  evidence_text?: string | null;
  created_at?: string;
}

interface SnapshotItem {
  item_id: string;
  title: string | null;
  entity_mentions: MentionRow[];
  holds_relationships: HoldsRelRow[];
}

interface Snapshot {
  items: Record<string, SnapshotItem>;
}

async function main(): Promise<void> {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  const snapshot: Snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));

  const targetItemIds =
    CORRUPTED_ITEM_IDS === 'ALL'
      ? Object.keys(snapshot.items)
      : CORRUPTED_ITEM_IDS;
  console.log(`[restore] Restoring ${targetItemIds.length} items from snapshot`);

  let restoredItems = 0;
  let restoredMentions = 0;
  let restoredRels = 0;

  for (const itemId of targetItemIds) {
    const item = snapshot.items[itemId];
    if (!item) {
      console.warn(`[restore] ${itemId}: NOT in snapshot, skipping`);
      continue;
    }

    // Delete current entity_mentions for this item
    const { error: delMentionsErr } = await supabase
      .from('entity_mentions')
      .delete()
      .eq('content_item_id', itemId);
    if (delMentionsErr) {
      console.error(
        `[restore] ${itemId}: delete mentions failed:`,
        delMentionsErr.message,
      );
      continue;
    }

    // Delete current holds relationships for this item (as source)
    const { error: delRelsErr } = await supabase
      .from('entity_relationships')
      .delete()
      .eq('source_item_id', itemId)
      .eq('relationship_type', 'holds');
    if (delRelsErr) {
      console.error(
        `[restore] ${itemId}: delete rels failed:`,
        delRelsErr.message,
      );
      continue;
    }

    // Re-insert mentions from snapshot (use original IDs to preserve any FKs
    // though none currently point at entity_mentions per classify.ts:1489).
    if (item.entity_mentions.length > 0) {
      // Strip undefined metadata so DB default (null) applies.
      const toInsert = item.entity_mentions.map((m) => ({
        id: m.id,
        content_item_id: m.content_item_id,
        entity_type: m.entity_type,
        entity_name: m.entity_name,
        canonical_name: m.canonical_name,
        confidence: m.confidence,
        context_snippet: m.context_snippet,
        metadata: m.metadata ?? null,
      }));
      const { error: insErr } = await supabase
        .from('entity_mentions')
        .insert(toInsert);
      if (insErr) {
        console.error(
          `[restore] ${itemId}: insert mentions failed:`,
          insErr.message,
        );
        continue;
      }
      restoredMentions += toInsert.length;
    }

    // Re-insert holds relationships from snapshot
    if (item.holds_relationships.length > 0) {
      const toInsertRels = item.holds_relationships.map((r) => ({
        id: r.id,
        source_item_id: r.source_item_id,
        source_entity: r.source_entity,
        relationship_type: r.relationship_type,
        target_entity: r.target_entity,
        confidence: r.confidence ?? 1.0,
      }));
      const { error: insRelsErr } = await supabase
        .from('entity_relationships')
        .insert(toInsertRels);
      if (insRelsErr) {
        console.error(
          `[restore] ${itemId}: insert rels failed:`,
          insRelsErr.message,
        );
        continue;
      }
      restoredRels += toInsertRels.length;
    }

    restoredItems++;
    console.log(
      `[restore] ${itemId}: ✓ ${item.entity_mentions.length} mentions, ${item.holds_relationships.length} holds rels`,
    );
  }

  console.log('');
  console.log(
    `[restore] Done. Items: ${restoredItems}/${targetItemIds.length}, mentions: ${restoredMentions}, holds rels: ${restoredRels}`,
  );
}

main().catch((err) => {
  console.error('[restore] Unexpected error:', err);
  process.exit(1);
});
