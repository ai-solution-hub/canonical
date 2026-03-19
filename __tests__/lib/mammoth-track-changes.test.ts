import { describe, it, expect } from 'vitest';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../docs/client-documentation/DRAFT 2026 Tender and Bid Library Template for example-client - Security and Compliance  - Copy.docx'
);

describe('mammoth Track Changes handling', () => {
  it('fixture file exists', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
  });

  it('excludes deleted text from HTML output', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { value: html } = await mammoth.convertToHtml({ buffer });

    // The deleted (pre-revision) date should NOT appear
    expect(html).not.toContain('28 August 2025');
  });

  it('includes inserted text in HTML output', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { value: html } = await mammoth.convertToHtml({ buffer });

    // The corrected date (accepted revision) should appear
    expect(html).toContain('28 August 2026');
  });

  it('matches pandoc ground truth for Track Changes resolution', async () => {
    // Generate ground truth with pandoc
    const pandocHtml = execFileSync('/opt/homebrew/bin/pandoc', [
      '--track-changes=accept',
      '-t', 'html',
      FIXTURE_PATH,
    ], { encoding: 'utf-8', timeout: 30_000 });

    // Generate mammoth output
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { value: mammothHtml } = await mammoth.convertToHtml({ buffer });

    // Both should exclude the deleted date
    expect(pandocHtml).not.toContain('28 August 2025');
    expect(mammothHtml).not.toContain('28 August 2025');

    // Both should include the corrected date
    expect(pandocHtml).toContain('28 August 2026');
    expect(mammothHtml).toContain('28 August 2026');

    // Both should contain the ICO registration reference (stable text)
    expect(pandocHtml).toContain('ZA123456');
    expect(mammothHtml).toContain('ZA123456');
  });

  it('produces non-empty HTML with table structure', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { value: html } = await mammoth.convertToHtml({ buffer });

    expect(html).toContain('<table>');
    expect(html).toContain('<tr>');
    expect(html).toContain('<td>');
  });
});
