#!/usr/bin/env bun
/**
 * Backfill source_documents for existing content items.
 *
 * Scans content_items that have no source_document_id but DO have provenance
 * data in metadata (source_file, original_filename) or file_path. Creates a
 * source_documents row for each unique source file, then links all content
 * items that came from that file.
 *
 * Items from the same source file (e.g. Q&A pairs extracted from one .docx)
 * share a single source_documents row.
 *
 * Usage:
 *   bun run scripts/backfill-source-documents.ts              # dry run (default)
 *   bun run scripts/backfill-source-documents.ts --apply       # write to database
 *   bun run scripts/backfill-source-documents.ts --limit 20    # process max 20 groups
 *   bun run scripts/backfill-source-documents.ts --apply --limit 5
 */

import { createHash } from 'crypto';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';

// ── Env loading (handles worktrees) ──────────────────────────────────────────

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

loadEnv();

// ── Args ─────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    limit: { type: 'string', default: '0' },
    help: { type: 'boolean', default: false },
    env: { type: 'string', default: '' },
  },
  strict: true,
});

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/backfill-source-documents.ts --env=prod`,
    );
    process.exit(1);
  }
}

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-source-documents.ts [options]

Options:
  --apply       Write changes to the database (default is dry run)
  --limit N     Max number of source document groups to process (0 = all)
  --env=prod    Asserts SUPABASE_URL points at current prod
                (the client production project; ref from PROD_PROJECT_REF). Override invocation:
                SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key>
                bun run scripts/backfill-source-documents.ts --env=prod
  --help        Show this help
`);
  process.exit(0);
}

const DRY_RUN = !args.apply;
const LIMIT = parseInt(args.limit!, 10) || 0;

// ── Supabase client ──────────────────────────────────────────────────────────

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment',
  );
  process.exit(1);
}

assertEnvFlag(args.env ?? '', supabaseUrl);

const supabase = createScriptClient(supabaseUrl, supabaseKey);

// Fallback admin user UUID for items with no created_by
const FALLBACK_ADMIN_ID = '2873f7a6-5c20-4b1e-b8d5-3cee6ad7e831';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Infer MIME type from file extension */
function inferMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.pptx':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.html': 'text/html',
    '.json': 'application/json',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/** Generate an MD5 hash of text content */
function md5Hash(text: string): string {
  return createHash('md5').update(text, 'utf-8').digest('hex');
}

/** Resolve the filename from available metadata */
function resolveFilename(item: ContentItemRow): string {
  const metadata = item.metadata as Record<string, unknown> | null;
  if (
    metadata?.original_filename &&
    typeof metadata.original_filename === 'string'
  ) {
    return metadata.original_filename;
  }
  if (item.source_file) {
    return item.source_file;
  }
  if (metadata?.source_file && typeof metadata.source_file === 'string') {
    return metadata.source_file;
  }
  if (item.file_path) {
    return path.basename(item.file_path);
  }
  return 'unknown';
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentItemRow {
  id: string;
  content: string;
  content_type: string | null;
  metadata: unknown;
  file_path: string | null;
  created_by: string | null;
  created_at: string | null;
  source_file: string | null;
}

interface SourceDocGroup {
  filename: string;
  items: ContentItemRow[];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Source Documents Backfill');
  console.log('='.repeat(60));
  console.log(
    `  Mode:   ${DRY_RUN ? 'DRY RUN (use --apply to write)' : 'APPLY'}`,
  );
  console.log(`  Limit:  ${LIMIT || 'all'}`);
  console.log();

  // ── Step 1: Fetch eligible content items ─────────────────────────────────

  // Supabase JS client doesn't support OR on JSONB easily, so we use a raw
  // RPC call. Alternatively, fetch all items without source_document_id and
  // filter in code.
  const { data: items, error } = await supabase
    .from('content_items')
    .select(
      'id, content, content_type, metadata, file_path, created_by, created_at, source_file',
    )
    .is('source_document_id', null)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log('No content items without source_document_id found.');
    return;
  }

  // Filter to items that actually have provenance data
  const eligible = items.filter((item: ContentItemRow) => {
    const metadata = item.metadata as Record<string, unknown> | null;
    return (
      item.source_file ||
      (metadata?.source_file && typeof metadata.source_file === 'string') ||
      (metadata?.original_filename &&
        typeof metadata.original_filename === 'string') ||
      item.file_path
    );
  }) as ContentItemRow[];

  console.log(`Found ${items.length} items without source_document_id`);
  console.log(`  With provenance data: ${eligible.length}`);
  console.log(
    `  Without provenance:   ${items.length - eligible.length} (skipped)`,
  );
  console.log();

  if (eligible.length === 0) {
    console.log('No eligible items to process.');
    return;
  }

  // ── Step 2: Group by filename ────────────────────────────────────────────

  const groupMap = new Map<string, ContentItemRow[]>();
  for (const item of eligible) {
    const filename = resolveFilename(item);
    if (!groupMap.has(filename)) {
      groupMap.set(filename, []);
    }
    groupMap.get(filename)!.push(item);
  }

  let groups: SourceDocGroup[] = Array.from(groupMap.entries()).map(
    ([filename, groupItems]) => ({ filename, items: groupItems }),
  );

  // Sort by item count descending for visibility
  groups.sort((a, b) => b.items.length - a.items.length);

  if (LIMIT > 0) {
    groups = groups.slice(0, LIMIT);
  }

  console.log(`Grouped into ${groups.length} unique source documents:`);
  for (const group of groups) {
    console.log(
      `  ${group.filename} (${group.items.length} item${group.items.length === 1 ? '' : 's'})`,
    );
  }
  console.log();

  // ── Step 3: Create source_documents and link content items ───────────────

  let created = 0;
  let linked = 0;
  let errors = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const progress = `[${i + 1}/${groups.length}]`;

    console.log(`${progress} ${group.filename} (${group.items.length} items)`);

    // Combine content from all items for a representative hash
    const combinedContent = group.items
      .map((item) => item.content)
      .join('\n---\n');
    const contentHash = md5Hash(combinedContent);

    // Use the earliest item's created_by as uploaded_by
    const uploadedBy =
      group.items.find((item) => item.created_by)?.created_by ||
      FALLBACK_ADMIN_ID;

    // Resolve storage path from first item's file_path if available
    const storagePath =
      group.items.find((item) => item.file_path)?.file_path || '';

    // Use earliest created_at for the source document timestamp
    const earliestCreatedAt = group.items
      .filter((item) => item.created_at)
      .sort((a, b) => (a.created_at! < b.created_at! ? -1 : 1))[0]?.created_at;

    // Build the extracted_text from content (truncate if very large)
    const extractedText =
      combinedContent.length > 500_000
        ? combinedContent.slice(0, 500_000) + '\n\n... (truncated)'
        : combinedContent;

    // Determine file size from metadata or content length
    const firstMetadata = group.items[0].metadata as Record<
      string,
      unknown
    > | null;
    const fileSize =
      (firstMetadata?.file_size && typeof firstMetadata.file_size === 'number'
        ? firstMetadata.file_size
        : null) ||
      (firstMetadata?.file_size && typeof firstMetadata.file_size === 'string'
        ? parseInt(firstMetadata.file_size, 10)
        : null) ||
      0;

    const sourceDoc = {
      filename: group.filename,
      original_filename: group.filename,
      mime_type: inferMimeType(group.filename),
      file_size: fileSize,
      content_hash: contentHash,
      version: 1,
      storage_path: storagePath,
      status: 'processed',
      uploaded_by: uploadedBy,
      extracted_text: extractedText,
      ...(earliestCreatedAt && { created_at: earliestCreatedAt }),
    };

    if (DRY_RUN) {
      console.log(
        `         Would create source_documents row: ${group.filename}`,
      );
      console.log(`         Would link ${group.items.length} content item(s)`);
      console.log(
        `         MIME: ${sourceDoc.mime_type}, hash: ${contentHash.slice(0, 12)}...`,
      );
      created++;
      linked += group.items.length;
      continue;
    }

    // Insert source_documents row
    const { data: inserted, error: insertError } = await supabase
      .from('source_documents')
      .insert(sourceDoc)
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error(
        `         ERROR creating source document: ${insertError?.message}`,
      );
      errors++;
      continue;
    }

    console.log(`         Created source_documents: ${inserted.id}`);
    created++;

    // Link content items to the new source document
    const itemIds = group.items.map((item) => item.id);
    const { error: updateError, count: updateCount } = await supabase
      .from('content_items')
      .update({ source_document_id: inserted.id })
      .in('id', itemIds);

    if (updateError) {
      console.error(`         ERROR linking items: ${updateError.message}`);
      errors++;
    } else {
      const updatedCount = updateCount ?? group.items.length;
      console.log(`         Linked ${updatedCount} content item(s)`);
      linked += updatedCount;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(
    `  Source documents created: ${created}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(
    `  Content items linked:    ${linked}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Errors:                  ${errors}`);
  if (DRY_RUN) {
    console.log();
    console.log('  This was a dry run. Use --apply to write changes.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
