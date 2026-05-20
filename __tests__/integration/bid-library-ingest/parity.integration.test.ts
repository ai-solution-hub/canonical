/**
 * CLI <-> TS parity integration test for Q&A DOCX extraction.
 *
 * Runs both the Python extractor (scripts/extract_docx_tables.py) and the
 * TS extractor (lib/bid-library-ingest/extract-qa-pairs.ts) against the same
 * fixture .docx files, then asserts:
 *   - Same number of pairs per file
 *   - Same question text per pair
 *   - Same markdown on answer_standard / answer_advanced per pair
 *
 * KNOWN PARITY GAP (scripts/extract_docx_tables.py `_cell_markdown` docstring):
 * The Python cell converter preserves bold+italic only, while the TS path
 * preserves links, lists, and nested tables via mammoth+Turndown. Fixtures
 * in `__tests__/fixtures/qa-docx-parity/` are simple enough to keep parity.
 * If a future fixture introduces hyperlinks, lists, or nested tables, the
 * test will correctly fail — either enhance `_cell_markdown` or downgrade
 * the fixture.
 *
 * Gated behind KH_RUN_INTEGRATION=1 (skip otherwise).
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss6.4, ss10.3.
 */

import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';

import {
  extractQaPairs,
  type QaPair,
} from '@/lib/procurement-library-ingest/extract-qa-pairs';

const execFileAsync = promisify(execFile);

const SKIP_REASON = 'Set KH_RUN_INTEGRATION=1 to run parity integration tests';
const shouldRun = process.env.KH_RUN_INTEGRATION === '1';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures/qa-docx-parity');

/** Fixture files to test parity on. */
const FIXTURE_FILES = ['audit-format.docx', 'draft-format.docx'];

/**
 * Run the Python extractor with emit_markdown=True on a fixture file.
 *
 * Returns an array of { question_text, answer_standard, answer_advanced }
 * dicts as JSON from a small Python wrapper script.
 */
async function runPythonExtractor(fixturePath: string): Promise<
  Array<{
    question_text: string;
    answer_standard: string;
    answer_advanced: string;
    section_name: string;
  }>
> {
  const script = `
import sys, json, os
sys.path.insert(0, os.path.join(os.path.dirname("${resolve('scripts')}"), "scripts"))
sys.path.insert(0, "${resolve('scripts')}")
from extract_docx_tables import extract_qa_from_docx
pairs = extract_qa_from_docx("${fixturePath}", emit_markdown=True)
output = [{"question_text": p["question_text"], "answer_standard": p["answer_standard"], "answer_advanced": p["answer_advanced"], "section_name": p["section_name"]} for p in pairs]
print(json.dumps(output))
`;

  const { stdout } = await execFileAsync('python3', ['-c', script], {
    timeout: 30000,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  return JSON.parse(stdout.trim()) as Array<{
    question_text: string;
    answer_standard: string;
    answer_advanced: string;
    section_name: string;
  }>;
}

/**
 * Normalise whitespace for comparison.
 *
 * Both extractors may introduce minor whitespace differences (trailing spaces,
 * trailing newlines) that are semantically irrelevant for markdown rendering.
 * This normaliser collapses those differences.
 */
function normaliseForComparison(text: string): string {
  return text
    .replace(/\r\n/g, '\n') // Normalise line endings
    .replace(/[ \t]+$/gm, '') // Strip trailing whitespace per line
    .trim(); // Strip leading/trailing whitespace
}

describe.skipIf(!shouldRun)('CLI <-> TS parity integration', () => {
  for (const fixtureFile of FIXTURE_FILES) {
    describe(fixtureFile, () => {
      const fixturePath = resolve(FIXTURES_DIR, fixtureFile);

      let tsPairs: QaPair[];
      let pyPairs: Array<{
        question_text: string;
        answer_standard: string;
        answer_advanced: string;
        section_name: string;
      }>;

      it('extracts from both TS and Python without error', async () => {
        const buffer = readFileSync(fixturePath);
        [tsPairs, pyPairs] = await Promise.all([
          extractQaPairs(buffer, fixtureFile),
          runPythonExtractor(fixturePath),
        ]);

        expect(tsPairs.length).toBeGreaterThan(0);
        expect(pyPairs.length).toBeGreaterThan(0);
      });

      it('produces the same number of pairs', async () => {
        const buffer = readFileSync(fixturePath);
        [tsPairs, pyPairs] = await Promise.all([
          extractQaPairs(buffer, fixtureFile),
          runPythonExtractor(fixturePath),
        ]);

        expect(tsPairs.length).toBe(pyPairs.length);
      });

      it('produces matching question text per pair', async () => {
        const buffer = readFileSync(fixturePath);
        [tsPairs, pyPairs] = await Promise.all([
          extractQaPairs(buffer, fixtureFile),
          runPythonExtractor(fixturePath),
        ]);

        for (let i = 0; i < tsPairs.length; i++) {
          expect(normaliseForComparison(tsPairs[i].questionText)).toBe(
            normaliseForComparison(pyPairs[i].question_text),
          );
        }
      });

      it('produces matching markdown on answer_standard per pair', async () => {
        const buffer = readFileSync(fixturePath);
        [tsPairs, pyPairs] = await Promise.all([
          extractQaPairs(buffer, fixtureFile),
          runPythonExtractor(fixturePath),
        ]);

        for (let i = 0; i < tsPairs.length; i++) {
          expect(normaliseForComparison(tsPairs[i].answerStandard)).toBe(
            normaliseForComparison(pyPairs[i].answer_standard),
          );
        }
      });

      it('produces matching markdown on answer_advanced per pair', async () => {
        const buffer = readFileSync(fixturePath);
        [tsPairs, pyPairs] = await Promise.all([
          extractQaPairs(buffer, fixtureFile),
          runPythonExtractor(fixturePath),
        ]);

        for (let i = 0; i < tsPairs.length; i++) {
          expect(normaliseForComparison(tsPairs[i].answerAdvanced)).toBe(
            normaliseForComparison(pyPairs[i].answer_advanced),
          );
        }
      });
    });
  }
});

// Fallback describe that always runs to indicate the skip reason
describe.skipIf(shouldRun)('CLI <-> TS parity integration (skipped)', () => {
  it.skip(SKIP_REASON, () => {});
});
