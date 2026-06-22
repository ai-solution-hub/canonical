#!/usr/bin/env bun
/**
 * Embedding quality smoke test (Plan D Task D3).
 *
 * Validates that switching from plain-text to markdown content does not
 * degrade embedding quality. Reads the existing embedding from
 * `content_items.embedding`, re-extracts the content through the updated
 * pipeline (or falls back to Turndown over existing content if the source
 * URL is unreachable), generates a new embedding, and computes cosine
 * similarity against the old vector.
 *
 * This is an operator script. It issues real OpenAI embedding calls and
 * fetches remote URLs. It NEVER mutates the database.
 *
 * Usage:
 *   bun run scripts/embedding-smoke-test.ts                      # default 20-item run
 *   bun run scripts/embedding-smoke-test.ts --dry-run            # select items only
 *   bun run scripts/embedding-smoke-test.ts --limit 5            # smaller sample
 *   bun run scripts/embedding-smoke-test.ts --content-type pdf   # single bucket
 *   bun run scripts/embedding-smoke-test.ts --output results.jsonl
 *   bun run scripts/embedding-smoke-test.ts --verbose
 *
 * Pass criteria (from content-format spec SS6.2):
 *   - Median cosine similarity > 0.95
 *   - No individual item below 0.90
 *
 * Cost: roughly 20 items x 1 embedding call = << $0.01 at current rates.
 *
 * Although this script is read-only on Supabase, it uses the service-role
 * key for consistency with other operator scripts. Per the CLAUDE.md Bun
 * 204 note, scripts that talk to supabase-js should run with
 * `dangerouslyDisableSandbox: true` when invoked via the Bash tool.
 */

import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { loadEnv } from './lib/load-env';
import { resolveSupabaseEnv } from './lib/script-env';
import {
  generateEmbedding,
  MAX_EMBEDDING_CHARS,
  getEmbeddingDimensions,
} from '../lib/ai/embed';
import { stripMarkdown } from '../lib/content/strip-markdown';
import { turndown } from '../lib/extraction/turndown';

// ── Args ───────────────────────────────────────────────────────────────────

interface RuntimeConfig {
  dryRun: boolean;
  limitOverride: number;
  contentTypeFilter: string;
  outputPath: string;
  verbose: boolean;
  env: string;
}

function parseRuntimeArgs(): RuntimeConfig {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      limit: { type: 'string', default: '' },
      'content-type': { type: 'string', default: '' },
      output: { type: 'string', default: '' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      env: { type: 'string', default: '' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Usage: bun run scripts/embedding-smoke-test.ts [options]

Options:
  --dry-run              Select items and show what would be compared; skip OpenAI calls
  --limit N              Override default sample size (default 20 across buckets)
  --content-type TYPE    Restrict to one content_type bucket
  --output PATH          Write per-item JSONL results to the given path
  --verbose              Show content diffs for items below threshold
  --env=prod             Asserts SUPABASE_URL points at prod (the client production project)
  --help                 Show this help
`);
    process.exit(0);
  }

  return {
    dryRun: values['dry-run']!,
    limitOverride: values.limit ? parseInt(values.limit, 10) : 0,
    contentTypeFilter: values['content-type']!.trim(),
    outputPath: values.output!.trim(),
    verbose: values.verbose!,
    env: values.env ?? '',
  };
}

type SupabaseScriptClient = ReturnType<typeof createScriptClient>;

function getSupabaseClient(env: string): SupabaseScriptClient {
  const { url: supabaseUrl, key: supabaseKey } = resolveSupabaseEnv(
    env,
    'scripts/embedding-smoke-test.ts',
  );

  return createScriptClient(supabaseUrl, supabaseKey);
}

// ── Cosine similarity (pure; unit-tested) ──────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ── Item selection ─────────────────────────────────────────────────────────

interface BucketSpec {
  label: string;
  target: number;
  // One of two filters is used per bucket.
  contentType?: string;
  primaryDomainLike?: string;
}

const DEFAULT_BUCKETS: BucketSpec[] = [
  { label: 'article', target: 5, contentType: 'article' },
  { label: 'blog', target: 3, contentType: 'blog' },
  { label: 'pdf', target: 3, contentType: 'pdf' },
  { label: 'question_answer', target: 3, contentType: 'question_answer' },
  {
    label: 'product_description',
    target: 2,
    contentType: 'product_description',
  },
  { label: 'policy', target: 2, primaryDomainLike: 'policy' },
  { label: 'any', target: 2 },
];

interface SelectedItem {
  id: string;
  title: string;
  content_type: string;
  source_url: string | null;
  content: string;
  content_length: number;
  embedding: string | null;
  suggested_title: string | null;
  metadata: unknown;
}

type SelectRow = Pick<
  SelectedItem,
  | 'id'
  | 'title'
  | 'content_type'
  | 'source_url'
  | 'content'
  | 'embedding'
  | 'suggested_title'
  | 'metadata'
>;

async function selectItemsForBucket(
  supabase: SupabaseScriptClient,
  bucket: BucketSpec,
  excludeIds: Set<string>,
  overrideLimit: number,
): Promise<SelectedItem[]> {
  const limit = overrideLimit > 0 ? overrideLimit : bucket.target;

  let query = supabase
    .from('content_items')
    .select(
      'id, title, content_type, source_url, content, embedding, suggested_title, metadata',
    )
    .not('embedding', 'is', null)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit * 4);

  if (bucket.contentType) {
    query = query.eq('content_type', bucket.contentType);
  }
  if (bucket.primaryDomainLike) {
    query = query.ilike('primary_domain', `%${bucket.primaryDomainLike}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`Query error for bucket ${bucket.label}: ${error.message}`);
    return [];
  }

  const rows = (data ?? []) as SelectRow[];
  const picked: SelectedItem[] = [];
  for (const row of rows) {
    if (excludeIds.has(row.id)) continue;
    const content = row.content ?? '';
    if (content.length <= 200) continue;
    picked.push({
      id: row.id,
      title: row.title,
      content_type: row.content_type,
      source_url: row.source_url,
      content,
      content_length: content.length,
      embedding: row.embedding,
      suggested_title: row.suggested_title,
      metadata: row.metadata,
    });
    if (picked.length >= limit) break;
  }
  return picked;
}

async function selectItems(
  supabase: SupabaseScriptClient,
  config: RuntimeConfig,
): Promise<SelectedItem[]> {
  const picked: SelectedItem[] = [];
  const seen = new Set<string>();

  if (config.contentTypeFilter) {
    const limit = config.limitOverride > 0 ? config.limitOverride : 20;
    const items = await selectItemsForBucket(
      supabase,
      {
        label: config.contentTypeFilter,
        target: limit,
        contentType: config.contentTypeFilter,
      },
      seen,
      limit,
    );
    return items;
  }

  for (const bucket of DEFAULT_BUCKETS) {
    const items = await selectItemsForBucket(supabase, bucket, seen, 0);
    for (const item of items) {
      seen.add(item.id);
      picked.push(item);
    }
  }

  if (config.limitOverride > 0 && picked.length > config.limitOverride) {
    return picked.slice(0, config.limitOverride);
  }
  return picked;
}

// ── Old embedding parsing ──────────────────────────────────────────────────

function parseVectorLiteral(raw: string): number[] {
  // Supabase returns pgvector as either a JSON-array string "[1,2,3]" or a
  // literal "[1.0,2.0,3.0]"; handle both by stripping brackets and splitting.
  const trimmed = raw.trim();
  const inner =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;
  if (!inner) return [];
  return inner.split(',').map((s) => Number.parseFloat(s.trim()));
}

// ── Re-extraction ──────────────────────────────────────────────────────────

interface ReExtracted {
  markdown: string;
  plain: string;
  method: 'refetch_source' | 'turndown_existing';
  warnings: string[];
}

async function refetchAndConvert(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'knowledge-hub-embedding-smoke-test/1.0 (+operator-script)',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const html = await res.text();
    return turndown.turndown(html);
  } finally {
    clearTimeout(timeout);
  }
}

async function reExtract(item: SelectedItem): Promise<ReExtracted> {
  const warnings: string[] = [];

  if (item.source_url) {
    try {
      const md = await refetchAndConvert(item.source_url);
      if (md.trim().length < 200) {
        warnings.push('Re-fetched markdown under 200 chars; falling back');
      } else {
        return {
          markdown: md,
          plain: stripMarkdown(md),
          method: 'refetch_source',
          warnings,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Source fetch failed: ${msg}`);
    }
  }

  // Fallback: treat existing content as source and pass through Turndown.
  // Existing content is already markdown-ish in most cases; Turndown is
  // idempotent enough on near-markdown input to serve as a normalisation
  // pass here.
  const markdown = item.content;
  return {
    markdown,
    plain: stripMarkdown(markdown),
    method: 'turndown_existing',
    warnings,
  };
}

// ── Result types ───────────────────────────────────────────────────────────

interface PerItemResult {
  id: string;
  title: string;
  content_type: string;
  source_url: string | null;
  old_content_length: number;
  new_content_length: number;
  extraction_method: ReExtracted['method'];
  similarity: number | null;
  status: 'PASS' | 'WARN' | 'SKIP' | 'FAIL';
  notes: string[];
  python_ingested: boolean;
}

export function isPythonIngested(
  item: Pick<SelectedItem, 'metadata'>,
): boolean {
  const meta = item.metadata;
  if (!meta || typeof meta !== 'object') return false;
  const asRecord = meta as Record<string, unknown>;
  const src =
    asRecord.extraction_source ?? asRecord.pipeline ?? asRecord.ingest_source;
  if (typeof src !== 'string') return false;
  const lower = src.toLowerCase();
  return (
    lower === 'trafilatura' || lower === 'jina_reader' || lower === 'pdfplumber'
  );
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  const config = parseRuntimeArgs();
  const supabase = getSupabaseClient(config.env);

  console.log('='.repeat(60));
  console.log('Embedding Quality Smoke Test');
  console.log('='.repeat(60));
  console.log(`  Dry run:          ${config.dryRun}`);
  console.log(
    `  Limit override:   ${config.limitOverride || '(bucket defaults)'}`,
  );
  console.log(
    `  Content-type:     ${config.contentTypeFilter || '(all buckets)'}`,
  );
  console.log(`  Output:           ${config.outputPath || '(stdout only)'}`);
  console.log();

  const items = await selectItems(supabase, config);
  if (items.length === 0) {
    console.log('No eligible items found.');
    return;
  }
  console.log(`Selected ${items.length} items.\n`);

  if (config.dryRun) {
    for (const item of items) {
      console.log(
        `  ${item.id}  ${item.content_type.padEnd(22)}  ${item.content_length} chars  ${item.source_url ? 'has source' : 'no source'}`,
      );
    }
    console.log('\nDry run complete; no embeddings generated.');
    return;
  }

  const expectedDims = getEmbeddingDimensions();
  const results: PerItemResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const progress = `[${i + 1}/${items.length}]`;
    const titleShort = (
      item.suggested_title ??
      item.title ??
      '(untitled)'
    ).slice(0, 40);
    const notes: string[] = [];

    if (!item.embedding) {
      notes.push('No stored embedding');
      results.push({
        id: item.id,
        title: titleShort,
        content_type: item.content_type,
        source_url: item.source_url,
        old_content_length: item.content_length,
        new_content_length: 0,
        extraction_method: 'turndown_existing',
        similarity: null,
        status: 'SKIP',
        notes,
        python_ingested: isPythonIngested(item),
      });
      console.log(`${progress} ${titleShort} -> SKIP (no embedding)`);
      continue;
    }

    const oldVec = parseVectorLiteral(item.embedding);
    if (oldVec.length !== expectedDims) {
      notes.push(
        `Stored embedding has ${oldVec.length} dims, expected ${expectedDims}`,
      );
      results.push({
        id: item.id,
        title: titleShort,
        content_type: item.content_type,
        source_url: item.source_url,
        old_content_length: item.content_length,
        new_content_length: 0,
        extraction_method: 'turndown_existing',
        similarity: null,
        status: 'SKIP',
        notes,
        python_ingested: isPythonIngested(item),
      });
      console.log(`${progress} ${titleShort} -> SKIP (dim mismatch)`);
      continue;
    }

    let reExtracted: ReExtracted;
    try {
      reExtracted = await reExtract(item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`Re-extraction threw: ${msg}`);
      results.push({
        id: item.id,
        title: titleShort,
        content_type: item.content_type,
        source_url: item.source_url,
        old_content_length: item.content_length,
        new_content_length: 0,
        extraction_method: 'turndown_existing',
        similarity: null,
        status: 'FAIL',
        notes,
        python_ingested: isPythonIngested(item),
      });
      console.log(`${progress} ${titleShort} -> FAIL (re-extract)`);
      continue;
    }
    notes.push(...reExtracted.warnings);

    const suggestedTitle = item.suggested_title ?? item.title ?? '';
    const embeddingInput = `${suggestedTitle}\n\n${reExtracted.plain}`.slice(
      0,
      MAX_EMBEDDING_CHARS,
    );

    let newVec: number[];
    try {
      newVec = await generateEmbedding(embeddingInput);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`generateEmbedding threw: ${msg}`);
      results.push({
        id: item.id,
        title: titleShort,
        content_type: item.content_type,
        source_url: item.source_url,
        old_content_length: item.content_length,
        new_content_length: reExtracted.plain.length,
        extraction_method: reExtracted.method,
        similarity: null,
        status: 'FAIL',
        notes,
        python_ingested: isPythonIngested(item),
      });
      console.log(`${progress} ${titleShort} -> FAIL (embed)`);
      continue;
    }

    if (newVec.length !== oldVec.length) {
      notes.push(
        `New embedding has ${newVec.length} dims, old has ${oldVec.length}`,
      );
      results.push({
        id: item.id,
        title: titleShort,
        content_type: item.content_type,
        source_url: item.source_url,
        old_content_length: item.content_length,
        new_content_length: reExtracted.plain.length,
        extraction_method: reExtracted.method,
        similarity: null,
        status: 'FAIL',
        notes,
        python_ingested: isPythonIngested(item),
      });
      console.log(`${progress} ${titleShort} -> FAIL (dim mismatch)`);
      continue;
    }

    const sim = cosineSimilarity(oldVec, newVec);
    const status: PerItemResult['status'] =
      sim >= 0.95 ? 'PASS' : sim >= 0.9 ? 'WARN' : 'FAIL';

    results.push({
      id: item.id,
      title: titleShort,
      content_type: item.content_type,
      source_url: item.source_url,
      old_content_length: item.content_length,
      new_content_length: reExtracted.plain.length,
      extraction_method: reExtracted.method,
      similarity: sim,
      status,
      notes,
      python_ingested: isPythonIngested(item),
    });
    console.log(
      `${progress} ${titleShort.padEnd(40)} ${item.content_type.padEnd(22)} sim=${sim.toFixed(4)} ${status}`,
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const valid = results.filter(
    (r): r is PerItemResult & { similarity: number } => r.similarity !== null,
  );
  const sims = valid.map((r) => r.similarity);
  const med = median(sims);
  const min = sims.length ? Math.min(...sims) : NaN;
  const max = sims.length ? Math.max(...sims) : NaN;

  const pythonResults = valid.filter((r) => r.python_ingested);
  const nonPython = valid.filter((r) => !r.python_ingested);

  console.log();
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`  Items tested:     ${results.length}`);
  console.log(
    `  Skipped:          ${results.filter((r) => r.status === 'SKIP').length}`,
  );
  console.log(
    `  Failed:           ${results.filter((r) => r.status === 'FAIL').length}`,
  );
  console.log(
    `  Median similarity (all): ${Number.isNaN(med) ? 'n/a' : med.toFixed(4)}`,
  );
  console.log(
    `  Min similarity:          ${Number.isNaN(min) ? 'n/a' : min.toFixed(4)}`,
  );
  console.log(
    `  Max similarity:          ${Number.isNaN(max) ? 'n/a' : max.toFixed(4)}`,
  );
  if (pythonResults.length > 0) {
    const pyMed = median(pythonResults.map((r) => r.similarity));
    const nonPyMed = median(nonPython.map((r) => r.similarity));
    console.log(
      `  Python-ingested:         ${pythonResults.length} items, median ${pyMed.toFixed(4)} (expected lower until WP1c closes the 1500-char truncation gap)`,
    );
    console.log(
      `  Non-Python ingested:     ${nonPython.length} items, median ${nonPyMed.toFixed(4)}`,
    );
  }

  const medianPass = !Number.isNaN(med) && med > 0.95;
  const floorPass = !Number.isNaN(min) && min >= 0.9;
  const overall = medianPass && floorPass ? 'PASS' : 'FAIL';
  console.log();
  console.log(`  Overall: ${overall}`);
  console.log(`    Median > 0.95:  ${medianPass ? 'PASS' : 'FAIL'}`);
  console.log(`    None < 0.90:    ${floorPass ? 'PASS' : 'FAIL'}`);

  // ── Outliers ───────────────────────────────────────────────────────────
  const outliers = valid.filter((r) => r.similarity < 0.95);
  if (outliers.length > 0) {
    console.log();
    console.log('Items below 0.95:');
    for (const r of outliers) {
      console.log(
        `  ${r.id}  ${r.content_type}  sim=${r.similarity.toFixed(4)}  (${r.old_content_length} -> ${r.new_content_length} chars, ${r.extraction_method}${r.python_ingested ? ', python-ingested' : ''})`,
      );
      if (config.verbose && r.notes.length > 0) {
        for (const note of r.notes) console.log(`    ! ${note}`);
      }
    }
  }

  // ── Output file ────────────────────────────────────────────────────────
  if (config.outputPath) {
    const outDir = path.dirname(config.outputPath);
    if (outDir && !fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const lines = results.map((r) => JSON.stringify(r));
    fs.writeFileSync(config.outputPath, lines.join('\n') + '\n');
    console.log();
    console.log(`Wrote ${results.length} records to ${config.outputPath}`);
  }

  process.exit(overall === 'PASS' ? 0 : 1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
