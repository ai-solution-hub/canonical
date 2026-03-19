/**
 * Entity Normalisation Backfill Script
 *
 * One-time script to re-normalise all entity_mentions.canonical_name and
 * entity_relationships.source_entity / target_entity using the enhanced
 * canonicalise() + resolveAlias() pipeline.
 *
 * Safe by default: --dry-run is the default. Pass --apply to execute changes.
 *
 * Usage:
 *   bun run scripts/normalise-entities.ts                  # dry run (default)
 *   bun run scripts/normalise-entities.ts --apply          # execute changes
 *   bun run scripts/normalise-entities.ts --verbose        # show every change
 *   bun run scripts/normalise-entities.ts --report         # summary report
 *   bun run scripts/normalise-entities.ts --type capability  # filter by type
 */

import { createClient } from '@supabase/supabase-js';
import { canonicalise } from '@/lib/entity-dedup';
import { resolveAlias, loadAliases } from '@/lib/entity-aliases';

// ── Env loading ──────────────────────────────────────────────────────────────

function loadEnvFile(path: string): void {
  try {
    const content = Bun.file(path).textSync();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — fine
  }
}

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ── CLI args ─────────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
  verbose: boolean;
  report: boolean;
  type: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let apply = false;
  let verbose = false;
  let report = false;
  let type: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--verbose') verbose = true;
    else if (args[i] === '--report') report = true;
    else if (args[i] === '--dry-run') apply = false; // explicit dry run
    else if (args[i] === '--type' && args[i + 1]) {
      type = args[i + 1];
      i++;
    }
  }

  return { apply, verbose, report, type };
}

// ── Normalisation pipeline ───────────────────────────────────────────────────

function normalise(name: string, entityType?: string): string {
  return resolveAlias(canonicalise(name, entityType));
}

// ── Types ────────────────────────────────────────────────────────────────────

interface EntityMentionRow {
  id: string;
  canonical_name: string;
  entity_type: string;
  entity_name: string;
  content_item_id: string;
  confidence: number | null;
  created_at: string | null;
}

interface EntityRelRow {
  id: string;
  source_entity: string;
  target_entity: string;
}

interface MergeGroup {
  newCanonical: string;
  entityType: string;
  contentItemId: string;
  rows: EntityMentionRow[];
  keepId: string;
  deleteIds: string[];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cli = parseArgs();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Load entity aliases from DB before normalisation
  await loadAliases(supabase);

  console.log(cli.apply ? '🔧 APPLY mode — changes will be written' : '👀 DRY RUN — no changes will be made');
  console.log('');

  // ── 1. Fetch all entity_mentions ──────────────────────────────────────────

  let query = supabase
    .from('entity_mentions')
    .select('id, canonical_name, entity_type, entity_name, content_item_id, confidence, created_at');

  if (cli.type) {
    query = query.eq('entity_type', cli.type);
    console.log(`Filtering to entity_type = '${cli.type}'`);
  }

  const { data: mentions, error: mentionError } = await query;

  if (mentionError) {
    console.error('Failed to fetch entity_mentions:', mentionError.message);
    process.exit(1);
  }

  const rows = mentions as EntityMentionRow[];
  console.log(`Fetched ${rows.length} entity_mentions rows`);

  // ── 2. Compute new canonical names ────────────────────────────────────────

  interface ChangeRecord {
    id: string;
    oldCanonical: string;
    newCanonical: string;
    entityType: string;
    contentItemId: string;
    confidence: number | null;
    createdAt: string | null;
  }

  const changes: ChangeRecord[] = [];
  const unchanged: number[] = [];

  for (const row of rows) {
    const newCanonical = normalise(row.canonical_name, row.entity_type);
    if (newCanonical !== row.canonical_name) {
      changes.push({
        id: row.id,
        oldCanonical: row.canonical_name,
        newCanonical,
        entityType: row.entity_type,
        contentItemId: row.content_item_id,
        confidence: row.confidence,
        createdAt: row.created_at,
      });
    } else {
      unchanged.push(1);
    }
  }

  console.log(`\nCanonical name changes: ${changes.length} rows`);
  console.log(`Unchanged: ${unchanged.length} rows`);

  if (cli.verbose) {
    for (const c of changes) {
      console.log(`  "${c.oldCanonical}" → "${c.newCanonical}" (${c.entityType})`);
    }
  }

  // ── 3. Detect merge groups (duplicate after renormalisation) ───────────────
  //
  // After renormalisation, some rows may share the same
  // (canonical_name, entity_type, content_item_id) — these are true duplicates
  // and need merging (keep highest confidence, then earliest created_at).

  // Build a map of all rows keyed by their (post-normalisation) composite key
  const compositeMap = new Map<string, EntityMentionRow[]>();

  for (const row of rows) {
    const newCanonical = normalise(row.canonical_name, row.entity_type);
    const key = `${newCanonical}|${row.entity_type}|${row.content_item_id}`;
    const existing = compositeMap.get(key) ?? [];
    existing.push({ ...row, canonical_name: newCanonical });
    compositeMap.set(key, existing);
  }

  const mergeGroups: MergeGroup[] = [];
  for (const [_key, groupRows] of compositeMap) {
    if (groupRows.length < 2) continue;

    // Sort: highest confidence first, then earliest created_at
    groupRows.sort((a, b) => {
      const confDiff = (b.confidence ?? 1) - (a.confidence ?? 1);
      if (confDiff !== 0) return confDiff;
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    });

    const keep = groupRows[0];
    const deleteIds = groupRows.slice(1).map((r) => r.id);

    mergeGroups.push({
      newCanonical: keep.canonical_name,
      entityType: keep.entity_type,
      contentItemId: keep.content_item_id,
      rows: groupRows,
      keepId: keep.id,
      deleteIds,
    });
  }

  const totalDeleteCount = mergeGroups.reduce((sum, g) => sum + g.deleteIds.length, 0);
  console.log(`\nMerge groups: ${mergeGroups.length} (${totalDeleteCount} duplicate rows to remove)`);

  if (cli.verbose && mergeGroups.length > 0) {
    for (const g of mergeGroups) {
      const origNames = g.rows.map((r) => `"${r.entity_name}"`).join(', ');
      console.log(`  ${g.newCanonical} (${g.entityType}): merging ${g.rows.length} rows — keeping ${g.keepId}, deleting ${g.deleteIds.length}. Original names: ${origNames}`);
    }
  }

  // ── 4. Compute entity_relationships updates ───────────────────────────────

  const { data: rels, error: relError } = await supabase
    .from('entity_relationships')
    .select('id, source_entity, target_entity');

  if (relError) {
    console.error('Failed to fetch entity_relationships:', relError.message);
    process.exit(1);
  }

  const relRows = rels as EntityRelRow[];
  console.log(`\nFetched ${relRows.length} entity_relationships rows`);

  interface RelChange {
    id: string;
    field: 'source_entity' | 'target_entity';
    oldValue: string;
    newValue: string;
  }

  const relChanges: RelChange[] = [];

  for (const rel of relRows) {
    const newSource = normalise(rel.source_entity);
    const newTarget = normalise(rel.target_entity);

    if (newSource !== rel.source_entity) {
      relChanges.push({ id: rel.id, field: 'source_entity', oldValue: rel.source_entity, newValue: newSource });
    }
    if (newTarget !== rel.target_entity) {
      relChanges.push({ id: rel.id, field: 'target_entity', oldValue: rel.target_entity, newValue: newTarget });
    }
  }

  console.log(`Relationship field changes: ${relChanges.length}`);

  if (cli.verbose && relChanges.length > 0) {
    for (const rc of relChanges) {
      console.log(`  ${rc.field}: "${rc.oldValue}" → "${rc.newValue}"`);
    }
  }

  // ── 5. Report ─────────────────────────────────────────────────────────────

  if (cli.report) {
    // Count unique canonical names before and after
    const beforeSet = new Set(rows.map((r) => `${r.canonical_name}|${r.entity_type}`));
    const afterSet = new Set(rows.map((r) => {
      const newCan = normalise(r.canonical_name, r.entity_type);
      return `${newCan}|${r.entity_type}`;
    }));

    console.log('\n══════════════════════════════════════════════');
    console.log('         NORMALISATION REPORT');
    console.log('══════════════════════════════════════════════');
    console.log(`Unique (canonical_name, type) BEFORE: ${beforeSet.size}`);
    console.log(`Unique (canonical_name, type) AFTER:  ${afterSet.size}`);
    console.log(`Reduction: ${beforeSet.size - afterSet.size} entities`);
    console.log(`Canonical name changes: ${changes.length} rows`);
    console.log(`Duplicate rows to remove: ${totalDeleteCount}`);
    console.log(`Relationship field updates: ${relChanges.length}`);
    console.log('══════════════════════════════════════════════');

    // Group changes by old→new for a readable merge summary
    const mergeSummary = new Map<string, { count: number; type: string }>();
    for (const c of changes) {
      const key = `${c.oldCanonical} → ${c.newCanonical}`;
      const existing = mergeSummary.get(key);
      if (existing) {
        existing.count++;
      } else {
        mergeSummary.set(key, { count: 1, type: c.entityType });
      }
    }

    if (mergeSummary.size > 0) {
      console.log('\nChange summary (old → new):');
      const sorted = [...mergeSummary.entries()].sort((a, b) => b[1].count - a[1].count);
      for (const [mapping, info] of sorted) {
        console.log(`  ${mapping} (${info.type}) × ${info.count}`);
      }
    }
  }

  // ── 6. Apply changes ──────────────────────────────────────────────────────

  if (!cli.apply) {
    console.log('\n✅ Dry run complete. Pass --apply to execute changes.');
    return;
  }

  console.log('\nApplying changes...');

  // 6a. Update canonical_name on changed rows
  let mentionUpdateCount = 0;
  for (const c of changes) {
    const { error } = await supabase
      .from('entity_mentions')
      .update({ canonical_name: c.newCanonical, normalisation_version: 2 })
      .eq('id', c.id);

    if (error) {
      console.error(`  ❌ Failed to update mention ${c.id}: ${error.message}`);
    } else {
      mentionUpdateCount++;
    }
  }
  console.log(`  Updated ${mentionUpdateCount}/${changes.length} entity_mentions rows`);

  // 6b. Update normalisation_version on unchanged rows (mark as processed)
  if (unchanged.length > 0) {
    const unchangedIds = rows
      .filter((r) => normalise(r.canonical_name, r.entity_type) === r.canonical_name)
      .map((r) => r.id);

    // Batch in chunks of 500
    for (let i = 0; i < unchangedIds.length; i += 500) {
      const chunk = unchangedIds.slice(i, i + 500);
      await supabase
        .from('entity_mentions')
        .update({ normalisation_version: 2 })
        .in('id', chunk);
    }
    console.log(`  Marked ${unchangedIds.length} unchanged rows as normalisation_version=2`);
  }

  // 6c. Delete duplicate rows from merge groups
  if (totalDeleteCount > 0) {
    const allDeleteIds = mergeGroups.flatMap((g) => g.deleteIds);
    for (let i = 0; i < allDeleteIds.length; i += 500) {
      const chunk = allDeleteIds.slice(i, i + 500);
      const { error } = await supabase
        .from('entity_mentions')
        .delete()
        .in('id', chunk);

      if (error) {
        console.error(`  ❌ Failed to delete duplicate mentions: ${error.message}`);
      }
    }
    console.log(`  Deleted ${allDeleteIds.length} duplicate entity_mentions rows`);
  }

  // 6d. Update entity_relationships
  // Group by id to batch source + target changes together
  const relUpdateMap = new Map<string, { source_entity?: string; target_entity?: string }>();
  for (const rc of relChanges) {
    const existing = relUpdateMap.get(rc.id) ?? {};
    existing[rc.field] = rc.newValue;
    relUpdateMap.set(rc.id, existing);
  }

  let relUpdateCount = 0;
  for (const [id, updates] of relUpdateMap) {
    const { error } = await supabase
      .from('entity_relationships')
      .update(updates)
      .eq('id', id);

    if (error) {
      console.error(`  ❌ Failed to update relationship ${id}: ${error.message}`);
    } else {
      relUpdateCount++;
    }
  }
  console.log(`  Updated ${relUpdateCount}/${relUpdateMap.size} entity_relationships rows`);

  console.log('\n✅ Backfill complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
