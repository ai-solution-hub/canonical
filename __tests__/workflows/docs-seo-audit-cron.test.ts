/**
 * ID-9.18 — OQ-T3 guard: docs-seo-audit.yml ships the monthly cron COMMENTED
 * OUT at foundation (the audit needs the deployed site's sitemap first). A
 * follow-up commit uncomments it post first-deploy.
 *
 * Spec: TECH §4.7; PRODUCT OQ-T3 ratified default.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const raw = readFileSync(
  join(process.cwd(), '.github/workflows/docs-seo-audit.yml'),
  'utf8',
);
const wf = parse(raw) as Record<string, unknown>;
const on = (wf.on ?? (wf as Record<string, unknown>)['true']) as Record<
  string,
  unknown
>;

describe('docs-seo-audit.yml cron deferral (ID-9.18 / OQ-T3)', () => {
  it('has the monthly cron present in the file but COMMENTED OUT', () => {
    expect(raw).toMatch(/#\s*-?\s*cron:\s*["']?0 7 1 \* \*/);
  });

  it('does NOT have an active schedule trigger (only workflow_dispatch)', () => {
    expect(on).toHaveProperty('workflow_dispatch');
    expect(on).not.toHaveProperty('schedule');
  });

  it('cites OQ-T3 in the deferral comment', () => {
    expect(raw).toContain('OQ-T3');
  });
});
