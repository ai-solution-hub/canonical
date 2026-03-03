#!/usr/bin/env bun
/**
 * Backfill reader_html for existing content items.
 *
 * Fetches articles, blogs, and newsletters that have a real source URL,
 * runs them through @mozilla/readability to extract clean reader HTML,
 * and stores the result in metadata.reader_html.
 *
 * Safety: only ADDS reader_html to existing metadata — never overwrites
 * other fields. Skips items that already have reader_html.
 *
 * Usage:
 *   bun run scripts/backfill-reader-html.ts                  # process all eligible
 *   bun run scripts/backfill-reader-html.ts --limit 50       # process max 50
 *   bun run scripts/backfill-reader-html.ts --dry-run        # preview without writing
 *   bun run scripts/backfill-reader-html.ts --type article   # only articles
 *   bun run scripts/backfill-reader-html.ts --batch-size 25  # batch size for DB query
 *   bun run scripts/backfill-reader-html.ts --delay 2000     # ms between fetches
 */

import { createClient } from "@supabase/supabase-js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { parseArgs } from "util";
import path from "path";
import fs from "fs";

// ── Env loading (handles worktrees) ────────────────────────────────────────

function loadEnv() {
  let dir = process.cwd();
  while (dir !== "/") {
    for (const file of [".env.local", ".env"]) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
    if (fs.existsSync(path.join(dir, "package.json"))) break;
    dir = path.dirname(dir);
  }
}

loadEnv();

// ── Args ───────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    limit: { type: "string", default: "0" },
    "dry-run": { type: "boolean", default: false },
    type: { type: "string", default: "" },
    "batch-size": { type: "string", default: "50" },
    delay: { type: "string", default: "1500" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-reader-html.ts [options]

Options:
  --limit N        Max items to process (0 = all eligible)
  --dry-run        Preview without writing to database
  --type TYPE      Filter by content_type (article, blog, newsletter)
  --batch-size N   Items per database query batch (default: 50)
  --delay MS       Milliseconds between HTTP fetches (default: 1500)
  --help           Show this help
`);
  process.exit(0);
}

const LIMIT = parseInt(args.limit!, 10) || 0;
const DRY_RUN = args["dry-run"]!;
const TYPE_FILTER = args.type!;
const BATCH_SIZE = parseInt(args["batch-size"]!, 10) || 50;
const DELAY_MS = parseInt(args.delay!, 10) || 1500;

// ── Supabase client ────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Eligible content types ─────────────────────────────────────────────────

const ELIGIBLE_TYPES = ["article", "blog", "newsletter", "product-page", "research"];

// ── Readability extraction ─────────────────────────────────────────────────

async function extractReaderHtml(
  url: string,
  html: string
): Promise<string | null> {
  try {
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article?.content || article.content.length < 100) {
      return null;
    }

    return article.content;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) IMS-Backfill/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("html")) return null;

    return await resp.text();
  } catch {
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("IMS Reader HTML Backfill");
  console.log("=".repeat(60));
  console.log(`  Limit:      ${LIMIT || "all"}`);
  console.log(`  Dry run:    ${DRY_RUN}`);
  console.log(`  Type:       ${TYPE_FILTER || "all eligible"}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Delay:      ${DELAY_MS}ms`);
  console.log();

  // Count eligible items
  const types = TYPE_FILTER ? [TYPE_FILTER] : ELIGIBLE_TYPES;

  let query = supabase
    .from("content_items")
    .select("id, suggested_title, source_url, content_type, metadata", {
      count: "exact",
    })
    .in("content_type", types)
    .like("source_url", "https://%")
    .not("source_url", "like", "gmail://%")
    .order("captured_date", { ascending: false });

  // We'll filter out items that already have reader_html in code
  // (Supabase doesn't have a clean NOT jsonb ? 'key' filter via JS client)

  if (LIMIT > 0) {
    query = query.limit(LIMIT);
  } else {
    query = query.limit(2000);
  }

  const { data: items, error, count } = await query;

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log("No eligible items found.");
    return;
  }

  // Filter out items that already have reader_html
  const eligible = items.filter(
    (item) => !(item.metadata as Record<string, unknown>)?.reader_html
  );

  console.log(`Found ${items.length} items matching criteria`);
  console.log(`  Already have reader_html: ${items.length - eligible.length}`);
  console.log(`  Eligible for backfill:    ${eligible.length}`);
  console.log();

  const toProcess = LIMIT > 0 ? eligible.slice(0, LIMIT) : eligible;

  // Process
  let ok = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    console.log(
      `${progress} ${item.content_type} | ${(item.suggested_title || "").slice(0, 60)}`
    );
    console.log(`         ${item.source_url}`);

    // Fetch HTML
    const html = await fetchHtml(item.source_url);
    if (!html) {
      console.log("         SKIP: fetch failed or not HTML");
      skipped++;
      continue;
    }

    // Extract with Readability
    const readerHtml = await extractReaderHtml(item.source_url, html);
    if (!readerHtml) {
      console.log("         SKIP: readability extraction failed or too short");
      skipped++;
      continue;
    }

    console.log(`         OK: ${readerHtml.length} chars of reader HTML`);

    if (DRY_RUN) {
      ok++;
      continue;
    }

    // Merge into existing metadata (safety: never overwrite other fields)
    const existingMetadata = (item.metadata as Record<string, unknown>) || {};
    const updatedMetadata = { ...existingMetadata, reader_html: readerHtml };

    const { error: updateError } = await supabase
      .from("content_items")
      .update({ metadata: updatedMetadata })
      .eq("id", item.id);

    if (updateError) {
      console.log(`         ERROR: ${updateError.message}`);
      errors++;
    } else {
      ok++;
    }

    // Rate limit
    if (i < toProcess.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log();
  console.log("=".repeat(60));
  console.log("BACKFILL COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Processed:  ${ok}${DRY_RUN ? " (dry run)" : ""}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  Errors:     ${errors}`);
  console.log(`  Time:       ${elapsed}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
