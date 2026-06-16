#!/usr/bin/env bun
/**
 * Snapshot current content_items state (Plan D Task D4 Step 1).
 *
 * Exports every row in `content_items` — including classification,
 * keywords, full embeddings, summary length, entity count, and chunk
 * count — to a JSONL file (one JSON object per line). Used as the
 * "before" artefact of the re-ingestion quality protocol.
 *
 * Output files can be large (1024-dim embeddings x thousands of items
 * ≈ hundreds of megabytes). The target directory `data/snapshots/` is
 * gitignored.
 *
 * Usage:
 *   bun run scripts/snapshot-content-state.ts
 *   bun run scripts/snapshot-content-state.ts --output snapshot.jsonl
 *   bun run scripts/snapshot-content-state.ts --no-embeddings   # lightweight
 *   bun run scripts/snapshot-content-state.ts --limit 100       # sanity check
 *
 * Although this script is read-only, it uses the service-role key to avoid
 * RLS filtering. Per CLAUDE.md's Bun 204 note, operator scripts that use
 * supabase-js should run with `dangerouslyDisableSandbox: true` when
 * invoked via the Bash tool.
 */

import { createLooseScriptClient } from '@/scripts/lib/supabase-script-client';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// ── Env loading (handles worktrees) ─────────────────────────────────────────

function loadEnv() {
  let dir = process.cwd();
  while (dir !== '/') {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) break;
    dir = path.dirname(dir);
  }
}

// ── Args ───────────────────────────────────────────────────────────────────

interface RuntimeConfig {
  outputPath: string;
  limit: number;
  batchSize: number;
  includeEmbeddings: boolean;
  env: string;
}

function defaultOutputPath(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return path.join(
    'data',
    'snapshots',
    `pre-reingest-${yyyy}-${mm}-${dd}.jsonl`,
  );
}

function parseRuntimeArgs(): RuntimeConfig {
  const { values } = parseArgs({
    options: {
      output: { type: 'string', default: '' },
      'no-embeddings': { type: 'boolean', default: false },
      limit: { type: 'string', default: '0' },
      'batch-size': { type: 'string', default: '500' },
      help: { type: 'boolean', default: false },
      env: { type: 'string', default: '' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Usage: bun run scripts/snapshot-content-state.ts [options]

Options:
  --output PATH        Destination file (default data/snapshots/pre-reingest-YYYY-MM-DD.jsonl)
  --no-embeddings      Skip the 1024-dim vector field (lightweight mode)
  --limit N            Limit total rows (0 = all)
  --batch-size N       Page size (default 500, max 1000)
  --env=prod           Asserts SUPABASE_URL points at prod ('rovrymhhffssilaftdwd')
  --help               Show this help
`);
    process.exit(0);
  }

  return {
    outputPath: values.output!.trim() || defaultOutputPath(),
    limit: parseInt(values.limit!, 10) || 0,
    batchSize: Math.min(parseInt(values['batch-size']!, 10) || 500, 1000),
    includeEmbeddings: !values['no-embeddings']!,
    env: (values.env as string) ?? '',
  };
}

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/snapshot-content-state.ts --env=prod`,
    );
    process.exit(1);
  }
}

type SupabaseScriptClient = ReturnType<typeof createLooseScriptClient>;

function getSupabaseClient(env: string): SupabaseScriptClient {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment',
    );
    process.exit(1);
  }

  assertEnvFlag(env, supabaseUrl);

  // <any>: complex `.select()` strings the typed parser rejects — intentionally
  // loose (see supabase-script-client.ts).
  return createLooseScriptClient(supabaseUrl, supabaseKey);
}

// ── Snapshot record ────────────────────────────────────────────────────────

export interface ContentSnapshot {
  id: string;
  title: string;
  content_type: string;
  source_url: string | null;
  content_length: number;
  primary_domain: string | null;
  primary_subtopic: string | null;
  classification_confidence: number | null;
  ai_keywords: string[] | null;
  user_tags: string[] | null;
  embedding: number[] | null;
  canonical_names: string[];
  summary_length: number | null;
  word_count: number;
  heading_count: number;
  chunk_count: number;
  created_at: string;
  freshness: string | null;
}

function parseVectorLiteral(raw: string | null): number[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const inner =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;
  if (!inner) return [];
  return inner.split(',').map((s) => Number.parseFloat(s.trim()));
}

function wordCount(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

function headingCount(content: string): number {
  return (content.match(/^#{1,6}\s+/gm) ?? []).length;
}

async function countBy(
  supabase: SupabaseScriptClient,
  table: 'content_chunks',
  ids: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;

  // `select('content_item_id')` returns every row, then we aggregate in JS.
  // Supabase-js doesn't expose PostgREST group-by cleanly; this is the
  // idiomatic approach for scripts like this one.
  const { data, error } = await supabase
    .from(table)
    .select('content_item_id')
    .in('content_item_id', ids);

  if (error) {
    console.error(`Failed to count ${table}: ${error.message}`);
    return counts;
  }
  for (const row of data ?? []) {
    const key = (row as { content_item_id: string }).content_item_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function namesBy(
  supabase: SupabaseScriptClient,
  ids: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from('entity_mentions')
    .select('content_item_id, canonical_name')
    .in('content_item_id', ids);

  if (error) {
    console.error(`Failed to fetch entity_mentions: ${error.message}`);
    return out;
  }
  for (const row of data ?? []) {
    const r = row as { content_item_id: string; canonical_name: string | null };
    if (!r.canonical_name) continue;
    const bucket = out.get(r.content_item_id) ?? new Set<string>();
    bucket.add(r.canonical_name);
    out.set(r.content_item_id, bucket);
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  const config = parseRuntimeArgs();
  const supabase = getSupabaseClient(config.env);

  console.log('='.repeat(60));
  console.log('Content State Snapshot');
  console.log('='.repeat(60));
  console.log(`  Output:            ${config.outputPath}`);
  console.log(`  Include embeddings: ${config.includeEmbeddings}`);
  console.log(`  Limit:             ${config.limit || 'all'}`);
  console.log(`  Batch size:        ${config.batchSize}`);
  console.log();

  const outDir = path.dirname(config.outputPath);
  if (outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(config.outputPath, '');

  let total = 0;
  let page = 0;

  while (true) {
    const from = page * config.batchSize;
    const to = from + config.batchSize - 1;

    const embeddingField = config.includeEmbeddings ? 'embedding,' : '';
    const { data, error } = await supabase
      .from('content_items')
      .select(
        `id, title, content, content_type, source_url, primary_domain, primary_subtopic, classification_confidence, ai_keywords, user_tags, ${embeddingField} summary, created_at, freshness`,
      )
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) {
      console.error(`Page ${page} query failed: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    const ids = data.map((row) => (row as unknown as { id: string }).id);
    const [entityNames, chunkCounts] = await Promise.all([
      namesBy(supabase, ids),
      countBy(supabase, 'content_chunks', ids),
    ]);

    const lines: string[] = [];
    for (const row of data) {
      const r = row as unknown as {
        id: string;
        title: string;
        content: string;
        content_type: string;
        source_url: string | null;
        primary_domain: string | null;
        primary_subtopic: string | null;
        classification_confidence: number | null;
        ai_keywords: string[] | null;
        user_tags: string[] | null;
        embedding?: string | null;
        summary: string | null;
        created_at: string;
        freshness: string | null;
      };

      const content = r.content ?? '';
      const snapshot: ContentSnapshot = {
        id: r.id,
        title: r.title,
        content_type: r.content_type,
        source_url: r.source_url,
        content_length: content.length,
        primary_domain: r.primary_domain,
        primary_subtopic: r.primary_subtopic,
        classification_confidence: r.classification_confidence,
        ai_keywords: r.ai_keywords,
        user_tags: r.user_tags,
        embedding: config.includeEmbeddings
          ? parseVectorLiteral(r.embedding ?? null)
          : null,
        canonical_names: Array.from(entityNames.get(r.id) ?? []),
        summary_length: r.summary ? r.summary.length : null,
        word_count: wordCount(content),
        heading_count: headingCount(content),
        chunk_count: chunkCounts.get(r.id) ?? 0,
        created_at: r.created_at,
        freshness: r.freshness,
      };
      lines.push(JSON.stringify(snapshot));
      total++;
      if (config.limit > 0 && total >= config.limit) break;
    }

    fs.appendFileSync(config.outputPath, lines.join('\n') + '\n');
    console.log(`  Page ${page}: wrote ${lines.length} rows (total ${total})`);

    if (config.limit > 0 && total >= config.limit) break;
    if (data.length < config.batchSize) break;
    page++;
  }

  console.log();
  console.log(`Snapshot complete: ${total} rows -> ${config.outputPath}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
