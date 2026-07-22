/**
 * strict-tool-schema-subset.test.ts — bl-471 regression guard.
 *
 * Fails the build if any lib/ or app/ source file that declares a strict
 * Anthropic tool (`strict: true`) expresses a JSON-schema type as an ARRAY
 * (`type: ['string', 'null']`). Array-valued `type` is outside Anthropic's
 * supported strict-mode JSON Schema subset — under `strict: true` it risks a
 * live API 400 / undefined behaviour. Nullability must be expressed with
 * `anyOf: [{type: 'x'}, {type: 'null'}]` (and for nullable enums,
 * `anyOf: [{type: 'string', enum: [...]}, {type: 'null'}]` — the API rejects
 * enum combined with an array type). Fix pattern: 0682d507 (ID-154).
 *
 * Non-strict tools tolerate the array form today, so files without
 * `strict: true` are not scanned — do NOT widen this guard to them without
 * migrating those sites first.
 *
 * Per docs/reference/testing/test-philosophy.md — pure file-read + regex, no fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'tinyglobby';

const PROJECT_ROOT = join(__dirname, '../..');

const ARRAY_VALUED_TYPE = /\btype:\s*\[/;

describe('strict tool input_schema stays inside the Anthropic strict-mode subset', () => {
  it('no file declaring a strict tool uses an array-valued schema type', () => {
    const files = globSync(['lib/**/*.ts', 'app/**/*.ts'], {
      cwd: PROJECT_ROOT,
      ignore: ['**/node_modules/**'],
    });

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(PROJECT_ROOT, file), 'utf8');
      if (!/\bstrict:\s*true\b/.test(text)) continue;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Comment lines may legitimately cite the rejected form when
        // explaining why anyOf is used (e.g. classify.ts source_scope).
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (ARRAY_VALUED_TYPE.test(line)) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`);
        }
      });
    }

    expect(
      offenders,
      `Array-valued \`type\` found in strict-tool file(s) — express nullability via anyOf (see this guard's header):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
