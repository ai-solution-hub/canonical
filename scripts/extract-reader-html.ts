#!/usr/bin/env bun
/**
 * Extract clean reader HTML from raw HTML via stdin.
 *
 * Usage: echo '<html>...</html>' | bun run scripts/extract-reader-html.ts [url]
 *
 * Reads raw HTML from stdin, parses with JSDOM, runs through Mozilla Readability,
 * and outputs clean article HTML to stdout.
 *
 * Exit codes:
 *   0 — success (clean HTML on stdout)
 *   1 — failure (error message on stderr)
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

async function main() {
  const url = process.argv[2] || 'https://example.com';

  // Read HTML from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  const html = Buffer.concat(chunks).toString('utf-8');

  if (!html || html.length < 50) {
    process.stderr.write('Input HTML too short or empty\n');
    process.exit(1);
  }

  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      process.stderr.write('Readability could not extract article content\n');
      process.exit(1);
    }

    process.stdout.write(article.content);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Readability extraction failed: ${err}\n`);
    process.exit(1);
  }
}

main();
