#!/usr/bin/env bun
/**
 * Roadmap shipped-framing detector — kh-prod-readiness-S38 W5 Phase 1.
 *
 * Pre-parse step that enforces the forward-looking-only doctrine for
 * `docs/reference/product-roadmap.md`. Sweeps the MD body for any
 * "shipped" framings — embedded SHIPPED markers, post-shipment
 * parentheticals, "shipped end-to-end" phrases — and emits an actionable
 * purge list to `.planning/.research/roadmap-shipped-framings.txt`.
 *
 * The MD-to-JSON converter (`scripts/roadmap-to-json.ts`, S39+) refuses
 * to emit JSON while findings exist. The operator purges flagged
 * framings (or migrates them to `state-of-the-product.md`) before
 * re-running.
 *
 * Schema decisions ratified at
 * `.planning/.research/s37-housekeeping/roadmap-conversion-approach.md` §6.1
 * Items 9 + 10. Item 9 explicitly chose Option (b) — drop entirely from
 * schema, enforce via this detector. Item 10 confirms the §5.4.4 EP2
 * markdown-batch parenthetical at the renamed file is a target case.
 *
 * Exit codes:
 *   0 — zero findings; converter may proceed.
 *   1 — at least one finding; converter must wait for operator purge.
 *   2 — input file missing or unreadable; configuration error.
 *
 * Output file format (line-oriented, easy diff):
 *   <path>:<line>:<section_id>: <suggested_action>: <text>
 *
 * Section ID resolution:
 *   Walks `## N. Title` -> `id = "N"` and `### N.M Title` -> `id = "N.M"`
 *   from the most recent heading above the match line. Empty string when
 *   the match precedes the first heading.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { parseArgs } from 'node:util';

interface Finding {
  line: number;
  section: string;
  text: string;
  suggested_action: 'PURGE' | 'MIGRATE_TO_SOTP';
  rule: string;
}

interface CliFlags {
  input: string;
  output: string;
  quiet: boolean;
}

const DEFAULT_INPUT = 'docs/reference/product-roadmap.md';
const DEFAULT_OUTPUT = '.planning/.research/roadmap-shipped-framings.txt';

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      'detect-roadmap-shipped-framings.ts\n\n' +
        'Sweeps the roadmap MD for shipped-framing patterns and emits an\n' +
        'actionable purge list. The MD-to-JSON converter blocks until\n' +
        'the list is empty.\n\n' +
        'Usage:\n' +
        '  bun run scripts/detect-roadmap-shipped-framings.ts \\\n' +
        '    [--input=' +
        DEFAULT_INPUT +
        '] \\\n' +
        '    [--output=' +
        DEFAULT_OUTPUT +
        '] \\\n' +
        '    [--quiet]\n\n' +
        'Exit codes:\n' +
        '  0 — zero findings\n' +
        '  1 — at least one finding (operator purge required)\n' +
        '  2 — input missing / unreadable\n',
    );
    process.exit(0);
  }

  return {
    input: values.input as string,
    output: values.output as string,
    quiet: Boolean(values.quiet),
  };
}

/**
 * Walk a stripped line array and resolve the most-recent section heading
 * for each line index. Returns an array of `id` strings (empty before
 * the first heading) parallel to the input lines.
 */
function buildSectionIndex(lines: string[]): string[] {
  const idByLine: string[] = new Array(lines.length).fill('');
  let current = '';
  const h2 = /^##\s+(\d+)\.\s+/;
  const h3 = /^###\s+(\d+(?:\.\d+)*)\s+/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m3 = h3.exec(line);
    if (m3) {
      current = m3[1];
    } else {
      const m2 = h2.exec(line);
      if (m2) current = m2[1];
    }
    idByLine[i] = current;
  }
  return idByLine;
}

/**
 * Detection rules — keyed by rule name, each emits zero or more
 * findings per matched line. The detector deliberately runs all rules
 * against every line; one line may yield multiple findings if it
 * matches more than one rule, and that overlap is informative for the
 * operator.
 */
const RULES: ReadonlyArray<{
  name: string;
  pattern: RegExp;
  suggested_action: Finding['suggested_action'];
}> = [
  {
    name: 'literal-SHIPPED-uppercase',
    pattern: /\bSHIPPED\b/,
    suggested_action: 'MIGRATE_TO_SOTP',
  },
  {
    name: 'parenthetical-shipped',
    pattern: /\([^)]*\bshipped\b[^)]*\)/i,
    suggested_action: 'PURGE',
  },
  {
    name: 'phrase-shipped-end-to-end',
    pattern: /\bshipped\s+end-to-end\b/i,
    suggested_action: 'MIGRATE_TO_SOTP',
  },
  {
    name: 'phrase-already-shipped',
    pattern: /\b(already|now|previously)\s+shipped\b/i,
    suggested_action: 'PURGE',
  },
  {
    name: 'phrase-phases-shipped',
    pattern: /\bphases?\s+[\d-]+\s+shipped\b/i,
    suggested_action: 'PURGE',
  },
];

function findFindings(content: string): Finding[] {
  const lines = content.split('\n');
  const sectionByLine = buildSectionIndex(lines);
  const out: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.trim().startsWith('#')) continue; // Section headings themselves are not framings.

    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        out.push({
          line: i + 1,
          section: sectionByLine[i],
          text: line.trim(),
          suggested_action: rule.suggested_action,
          rule: rule.name,
        });
      }
    }
  }
  return out;
}

function formatFindings(input: string, findings: Finding[]): string {
  if (findings.length === 0) {
    return (
      '# Shipped-framing detector — ' +
      new Date().toISOString() +
      '\n# input: ' +
      input +
      '\n# zero findings — converter may proceed\n'
    );
  }
  const header =
    '# Shipped-framing detector — ' +
    new Date().toISOString() +
    '\n' +
    '# input: ' +
    input +
    '\n' +
    '# ' +
    findings.length +
    ' finding(s) — operator purge required before MD→JSON conversion\n' +
    '#\n' +
    '# Format: <path>:<line>:<section_id>: <suggested_action> [<rule>]: <text>\n' +
    '#\n' +
    '# Suggested actions:\n' +
    '#   PURGE — strip the framing in place; the surrounding sentence loses no meaning\n' +
    '#   MIGRATE_TO_SOTP — capability is shipped; move the row to state-of-the-product.md (§ matching the roadmap section)\n' +
    '#\n';

  const body = findings
    .map(
      (f) =>
        input +
        ':' +
        f.line +
        ':' +
        (f.section || '?') +
        ': ' +
        f.suggested_action +
        ' [' +
        f.rule +
        ']: ' +
        f.text,
    )
    .join('\n');

  return header + '\n' + body + '\n';
}

function main(): void {
  const flags = parseCli();
  const inputPath = resolve(process.cwd(), flags.input);
  const outputPath = resolve(process.cwd(), flags.output);

  if (!existsSync(inputPath)) {
    console.error(
      'detect-roadmap-shipped-framings: input not found: ' + inputPath,
    );
    process.exit(2);
  }

  let content: string;
  try {
    content = readFileSync(inputPath, 'utf-8');
  } catch (err) {
    console.error(
      'detect-roadmap-shipped-framings: cannot read input: ' +
        (err as Error).message,
    );
    process.exit(2);
  }

  const findings = findFindings(content);
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(outputPath, formatFindings(flags.input, findings), 'utf-8');

  if (!flags.quiet) {
    if (findings.length === 0) {
      console.log(
        'detect-roadmap-shipped-framings: 0 findings (converter may proceed)\n' +
          '  output: ' +
          flags.output,
      );
    } else {
      console.log(
        'detect-roadmap-shipped-framings: ' +
          findings.length +
          ' finding(s)\n' +
          '  input:  ' +
          flags.input +
          '\n' +
          '  output: ' +
          flags.output +
          '\n' +
          '  Operator: review + purge before re-running the MD→JSON converter.',
      );
    }
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

main();
