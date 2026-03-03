/**
 * Knowledge Hub Semantic Search CLI
 *
 * Wraps the full hybrid search flow: generate embedding via OpenAI,
 * call hybrid_search RPC on Supabase, format and display results.
 *
 * Usage:
 *   bun run scripts/kb-search.ts "memory solutions for LLM agents"
 *   bun run scripts/kb-search.ts "MCP server patterns" --limit 5 --domain "AI & EMERGING TECH"
 *   bun run scripts/kb-search.ts "knowledge graphs for code" --full
 *   bun run scripts/kb-search.ts "RAG vs fine-tuning" --json
 *   bun run scripts/kb-search.ts "startup metrics" --threshold 0.3
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// ── Env loading ──

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Don't override existing env vars (so .env.local takes priority if loaded first)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — that's fine
  }
}

// Resolve project root: walk up from script dir and cwd to find .env
function findProjectRoot(): string {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const candidates = new Set<string>();

  // Walk up from script directory
  let dir = resolve(scriptDir, '..');
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Walk up from cwd (handles worktrees where script is symlinked)
  dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const root of candidates) {
    if (
      existsSync(resolve(root, '.env')) ||
      existsSync(resolve(root, '.env.local'))
    ) {
      return root;
    }
  }

  // Fallback to script parent directory
  return resolve(scriptDir, '..');
}

// Load .env.local first (higher priority), then .env
const PROJECT_ROOT = findProjectRoot();
loadEnvFile(resolve(PROJECT_ROOT, '.env.local'));
loadEnvFile(resolve(PROJECT_ROOT, '.env'));

// ── Types ──

interface SearchResult {
  id: string;
  title: string | null;
  suggested_title: string | null;
  ai_summary: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  content_type: string | null;
  platform: string | null;
  author_name: string | null;
  source_domain: string | null;
  thumbnail_url: string | null;
  captured_date: string | null;
  ai_keywords: string[] | null;
  classification_confidence: number | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
  snippet: string | null;
}

interface SummaryData {
  executive?: string;
  detailed?: string;
  takeaways?: string[];
  [key: string]: unknown;
}

interface CliArgs {
  query: string;
  limit: number;
  domain: string | null;
  full: boolean;
  json: boolean;
  threshold: number;
}

// ── CLI arg parsing ──

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let query = '';
  let limit = 10;
  let domain: string | null = null;
  let full = false;
  let json = false;
  let threshold = 0.25;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--domain' && args[i + 1]) {
      domain = args[i + 1];
      i++;
    } else if (arg === '--full') {
      full = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--threshold' && args[i + 1]) {
      threshold = parseFloat(args[i + 1]);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      // Positional arg = query
      query = arg;
    }
  }

  if (!query) {
    console.error('Error: No search query provided.\n');
    printUsage();
    process.exit(1);
  }

  if (isNaN(limit) || limit < 1) limit = 10;
  if (isNaN(threshold) || threshold < 0 || threshold > 1) threshold = 0.25;

  return { query, limit, domain, full, json, threshold };
}

function printUsage(): void {
  console.log(`Usage: bun run scripts/kb-search.ts <query> [options]

Options:
  --limit N          Max results to return (default: 10)
  --domain "NAME"    Filter by primary_domain (case-insensitive)
  --full             Include executive summary for each result
  --json             Output raw JSON instead of formatted text
  --threshold N      Similarity threshold 0-1 (default: 0.25)
  --help, -h         Show this help message

Examples:
  bun run scripts/kb-search.ts "memory solutions for LLM agents"
  bun run scripts/kb-search.ts "MCP server patterns" --limit 5
  bun run scripts/kb-search.ts "startup metrics" --domain "BUSINESS & STRATEGY"
  bun run scripts/kb-search.ts "RAG vs fine-tuning" --full --json`);
}

// ── Formatting helpers ──

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'unknown';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ── Main ──

async function main(): Promise<void> {
  const { query, limit, domain, full, json, threshold } = parseArgs();

  // Validate env
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Missing SUPABASE_URL / SUPABASE_ANON_KEY (or NEXT_PUBLIC_ variants) in environment',
    );
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('Missing OPENAI_API_KEY in environment');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  // 1. Generate embedding
  if (!json) {
    console.log(`\nKB Search: "${query}"`);
    console.log('Generating embedding...');
  }

  let embedding: number[];
  try {
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: query.trim(),
      dimensions: 1024,
    });
    embedding = embeddingResponse.data[0].embedding;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to generate embedding: ${message}`);
    process.exit(1);
  }

  // 2. Call hybrid_search RPC
  // CRITICAL: Supabase RPC needs JSON.stringify(embedding) not raw array for vector params
  const { data: results, error: rpcError } = await supabase.rpc(
    'hybrid_search',
    {
      query_embedding: JSON.stringify(embedding),
      query_text: query.trim(),
      similarity_threshold: threshold,
      limit_count: limit,
    },
  );

  if (rpcError) {
    console.error(`Search RPC error: ${rpcError.message}`);
    process.exit(1);
  }

  let filtered: SearchResult[] = (results as SearchResult[]) ?? [];

  // 3. Optionally filter by domain
  if (domain) {
    const domainLower = domain.toLowerCase();
    filtered = filtered.filter(
      (r) => r.primary_domain?.toLowerCase() === domainLower,
    );
  }

  // 4. Optionally fetch summary_data for --full
  let summaryMap: Map<string, SummaryData> = new Map();
  if (full && filtered.length > 0) {
    const ids = filtered.map((r) => r.id);
    const { data: summaryRows, error: summaryError } = await supabase
      .from('content_items')
      .select('id, summary_data')
      .in('id', ids);

    if (summaryError) {
      if (!json) {
        console.error(
          `Warning: Could not fetch summary data: ${summaryError.message}`,
        );
      }
    } else if (summaryRows) {
      for (const row of summaryRows) {
        if (row.summary_data) {
          summaryMap.set(row.id, row.summary_data as SummaryData);
        }
      }
    }
  }

  // 5. Format output
  if (json) {
    // JSON mode: enrich with summary_data if --full
    const output = filtered.map((r) => {
      const base: Record<string, unknown> = { ...r };
      if (full) {
        base.summary_data = summaryMap.get(r.id) ?? null;
      }
      return base;
    });
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Formatted text output
  const domainNote = domain ? ` | domain: "${domain}"` : '';
  console.log(
    `Found ${filtered.length} results (threshold: ${threshold}${domainNote})\n`,
  );

  if (filtered.length === 0) {
    console.log('No matching results. Try a lower --threshold or broader query.');
    return;
  }

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const displayTitle = r.suggested_title || r.title || 'Untitled';
    const sim = r.similarity.toFixed(2);
    const contentType = r.content_type || 'unknown';
    const platform = r.platform || 'unknown';

    console.log(
      `${String(i + 1).padStart(3)}. [${sim}] "${truncate(displayTitle, 70)}" (${contentType}, ${platform})`,
    );

    // Author + Domain line
    const parts: string[] = [];
    if (r.author_name) parts.push(`Author: ${r.author_name}`);
    parts.push(
      `Domain: ${r.primary_domain || 'unclassified'}${r.primary_subtopic ? ' / ' + r.primary_subtopic : ''}`,
    );
    if (r.captured_date) parts.push(`Date: ${formatDate(r.captured_date)}`);
    console.log(`      ${parts.join(' | ')}`);

    // Keywords
    if (r.ai_keywords && r.ai_keywords.length > 0) {
      console.log(`      Keywords: ${r.ai_keywords.join(', ')}`);
    }

    // Summary (--full mode)
    if (full) {
      const summary = summaryMap.get(r.id);
      if (summary?.executive) {
        console.log(`      Summary: ${truncate(summary.executive, 120)}`);
      } else if (r.ai_summary) {
        console.log(`      Summary: ${truncate(r.ai_summary, 120)}`);
      }
    }

    // Snippet (if available and not in --full mode, show a brief snippet)
    if (!full && r.snippet) {
      const cleanSnippet = r.snippet.replace(/\s+/g, ' ').trim();
      if (cleanSnippet.length > 10) {
        console.log(`      Snippet: ...${truncate(cleanSnippet, 100)}...`);
      }
    }

    console.log('');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
