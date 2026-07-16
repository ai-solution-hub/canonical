/**
 * ContentRenderer Component Tests
 *
 * Tests the ContentRenderer component — plain text rendering,
 * markdown detection and rendering, and heading id slugification.
 *
 * `ContentRenderer` migrated react-markdown + remark-gfm -> Streamdown
 * (DR-040, ID-145.46, folded from id-147 PRODUCT §I1/§I2/§I3, TECH §7). The
 * "Streamdown migration parity" describe block below is the named,
 * stored rendered-output snapshot the migration Subtask requires
 * (`content-renderer-streamdown-parity.snapshot`) — it renders a
 * representative markdown corpus through BOTH the incumbent react-markdown
 * path (a bare `<Markdown remarkPlugins={[remarkGfm]}>` harness, since that
 * package remains installed for `components/okf/bundle-log.tsx` and
 * `components/okf/concept-detail.tsx`, ID-132's still-incumbent sites — see
 * that Subtask's `details` for why those two are deliberately NOT migrated
 * here) and the migrated `<ContentRenderer>` (Streamdown) path, and asserts
 * the extracted structural content (headings/links/lists/bold/GFM
 * tables/blockquotes/code) is unchanged — proving §I2 "no visible
 * regression". Heading-id injection and target=_blank/rel=noopener external
 * link hardening are deliberate, spec-required (§I3) differences from the
 * bare-react-markdown baseline harness, so they are asserted separately,
 * never folded into the baseline-vs-migrated structural diff.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ContentRenderer } from '@/components/item-detail/content-renderer';

// ---------------------------------------------------------------------------
// Streamdown migration parity — shared helpers
// ---------------------------------------------------------------------------

/** Streamdown lazy-loads its Shiki code-block highlighter; a pending resolve
 * that lands after a synchronous test body returns leaks a React "not
 * wrapped in act" warning into a LATER test (`setup.ts` throws on it). Flush
 * one tick inside `act()` before extracting/asserting/unmounting whenever a
 * rendered corpus contains a fenced code block. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

interface StructuralSummary {
  headings: { tag: string; text: string }[];
  links: { text: string; href: string | null }[];
  lists: string[][];
  bold: string[];
  boldTags: string[];
  tables: { headers: string[]; rows: string[][] }[];
  blockquotes: string[];
  code: string[];
  codeHighlighted: boolean;
}

function normaliseWhitespace(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Extracts the observable content structure from a rendered container —
 * deliberately excludes heading `id`/link `target`/`rel` attributes, which
 * are §I3 hardening additions the bare react-markdown baseline never had
 * (asserted separately below), not part of the "visible regression" check. */
function extractStructuralSummary(container: HTMLElement): StructuralSummary {
  const headings = Array.from(
    container.querySelectorAll('h1,h2,h3,h4,h5,h6'),
  ).map((h) => ({ tag: h.tagName, text: normaliseWhitespace(h.textContent) }));

  const links = Array.from(container.querySelectorAll('a')).map((a) => ({
    text: normaliseWhitespace(a.textContent),
    href: a.getAttribute('href'),
  }));

  const lists = Array.from(container.querySelectorAll('ul, ol')).map((list) =>
    Array.from(list.children)
      .filter((el) => el.tagName === 'LI')
      .map((li) => normaliseWhitespace(li.textContent)),
  );

  // react-markdown renders `**bold**` as a semantic `<strong>`. Streamdown's
  // un-overridden default renders `<span data-streamdown="strong">` instead
  // (visually identical bold weight, no `<strong>` tag — a WCAG gap); the
  // ID-145.46 `strong` override restores the semantic tag so the migrated
  // path matches the baseline exactly. The `[data-streamdown="strong"]`
  // selector is kept only as a defensive fallback (so a regression back to
  // Streamdown's default still surfaces as bold content, not silence) —
  // `boldTags` below asserts the actual tag name used, closing that gap.
  const boldEls = Array.from(
    container.querySelectorAll('strong, b, [data-streamdown="strong"]'),
  );
  const bold = boldEls.map((el) => normaliseWhitespace(el.textContent));
  const boldTags = boldEls.map((el) => el.tagName);

  const tables = Array.from(container.querySelectorAll('table')).map(
    (table) => ({
      headers: Array.from(table.querySelectorAll('thead th')).map((th) =>
        normaliseWhitespace(th.textContent),
      ),
      rows: Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) =>
          normaliseWhitespace(td.textContent),
        ),
      ),
    }),
  );

  const blockquotes = Array.from(container.querySelectorAll('blockquote')).map(
    (bq) => normaliseWhitespace(bq.textContent),
  );

  const codeBlocks = Array.from(container.querySelectorAll('pre'));
  const code = codeBlocks.map((pre) => normaliseWhitespace(pre.textContent));
  // ID-145.46: Streamdown's un-overridden default `code` lazy-loads a Shiki
  // highlighter chunk that wraps every token in its own `<span>` and stamps
  // `data-streamdown` markers on the tree — the async chunk resolution is
  // what leaked React act() warnings and broke the suite. The `code`
  // override renders plain, non-highlighted markup instead; `codeHighlighted`
  // asserts no Shiki/Streamdown artifact survives in either renderer's
  // output (both the react-markdown baseline and the fixed migrated path
  // must be plain).
  const codeHighlighted = codeBlocks.some(
    (pre) =>
      pre.hasAttribute('data-streamdown') ||
      pre.querySelector('[data-streamdown], span') !== null,
  );

  return {
    headings,
    links,
    lists,
    bold,
    boldTags,
    tables,
    blockquotes,
    code,
    codeHighlighted,
  };
}

/** The incumbent renderer's exact former configuration (no heading-id
 * override, no link hardening — react-markdown never had either), used only
 * to capture the historical baseline this migration must not visibly
 * regress against. */
function renderBaseline(content: string) {
  return render(<Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>);
}

function renderMigrated(content: string) {
  return render(<ContentRenderer content={content} />);
}

// The required enumerated corpus (testStrategy): headings, links, lists,
// bold, GFM tables, blockquotes, code.
const CORE_CORPUS = [
  '## Data Security',
  '',
  'Some **bold** text here with a [link to our site](https://example.com/security) for details.',
  '',
  '- First item',
  '- Second item',
  '- Third item',
  '',
  '| Feature | Status |',
  '| --- | --- |',
  '| Encryption | Enabled |',
  '| Access control | Enabled |',
  '',
  '> A blockquote about data handling.',
  '',
  '```ts',
  'const configValue = 1;',
  '```',
  '',
  '## Cloud Infrastructure',
  '',
  'More content on cloud infrastructure practices.',
].join('\n');

// Orchestrator-hardening blob (b): response-version-history / review-card
// style content — prose + code + blockquote + list — the shape
// `review-card.test.tsx` / `review-card-cadence.test.tsx` cannot exercise
// because they `vi.mock` ContentRenderer entirely.
const REVIEW_STYLE_CORPUS = [
  'Reviewed the latest submission against the standard criteria before sign-off.',
  '',
  '```json',
  '{ "status": "approved" }',
  '```',
  '',
  '> Reviewer note: minor formatting issues remain outstanding.',
  '',
  '- Formatting',
  '- Terminology',
  '- Completeness',
].join('\n');

// Orchestrator-hardening blob (a): QA-pair style content — headings + GFM
// table + an internal relative `.md` link (exercises
// `normaliseInternalMdLinksForStreamdown`, §I3) + an external link.
const QA_PAIR_CORPUS = [
  '## Answer Summary',
  '',
  '| Criterion | Result |',
  '| --- | --- |',
  '| Coverage | Met |',
  '| Confidence | High |',
  '',
  'See [related guidance](./related-guidance.md) for background, and the [official register](https://example.com/register) for the source record.',
].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders plain text as paragraphs when no markdown is detected', () => {
    const text = 'First paragraph\n\nSecond paragraph';
    render(<ContentRenderer content={text} />);
    expect(screen.getByText('First paragraph')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph')).toBeInTheDocument();
  });

  it('renders markdown through Streamdown when detected', () => {
    const md = '## Hello World\n\nSome text here.';
    render(<ContentRenderer content={md} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('detects headings as markdown', () => {
    const md = '# Top Heading\n\nBody text.';
    render(<ContentRenderer content={md} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('detects links as markdown', () => {
    const md = 'Visit [our site](https://example.com) for details.';
    render(<ContentRenderer content={md} />);
    const link = screen.getByRole('link', { name: 'our site' });
    // Streamdown's bundled rehype-harden pass canonicalises a bare-origin
    // URL through the WHATWG URL constructor, which appends the trailing
    // slash — a harmless, expected difference from the pre-migration
    // (unhardened) react-markdown behaviour, not a regression (§I3).
    expect(link).toHaveAttribute('href', 'https://example.com/');
  });

  it('detects lists as markdown', () => {
    const md = '- Item one\n- Item two\n- Item three';
    render(<ContentRenderer content={md} />);
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(3);
  });

  it('adds slugified ids to headings', () => {
    const md = '## Data Security\n\nContent here.\n\n## Cloud Infrastructure';
    render(<ContentRenderer content={md} />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveAttribute('id', 'data-security');
    expect(headings[1]).toHaveAttribute('id', 'cloud-infrastructure');
  });

  // -------------------------------------------------------------------------
  // Streamdown migration parity (ID-145.46, DR-040, §I1/§I2/§I3)
  // -------------------------------------------------------------------------
  describe('Streamdown migration parity', () => {
    it('external links open hardened, in a new tab, with the full URL shown (§I3)', async () => {
      render(<ContentRenderer content={CORE_CORPUS} />);
      await settle(); // CORE_CORPUS has a fenced code block (Shiki lazy-loads)
      const link = screen.getByRole('link', { name: 'link to our site' });
      expect(link).toHaveAttribute('href', 'https://example.com/security');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('an internal relative .md link survives rehype-harden instead of being blocked (§I3)', () => {
      render(<ContentRenderer content={QA_PAIR_CORPUS} />);
      const link = screen.getByRole('link', { name: 'related guidance' });
      const href = link.getAttribute('href');
      expect(href).not.toBeNull();
      expect(href).not.toMatch(/blocked/i);
      expect(href).not.toContain('__okf-internal-link__');
      expect(href).toBe('/related-guidance.md');
      // The external link in the same blob is unaffected by the internal
      // link normalisation and stays hardened + full-URL per the same test.
      const externalLink = screen.getByRole('link', {
        name: 'official register',
      });
      expect(externalLink).toHaveAttribute(
        'href',
        'https://example.com/register',
      );
      expect(externalLink).toHaveAttribute('target', '_blank');
    });

    it('renders the QA-pair-style GFM table (headings + table survive the internal-link normalisation pass)', () => {
      render(<ContentRenderer content={QA_PAIR_CORPUS} />);
      expect(
        screen.getByRole('heading', { name: 'Answer Summary' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('columnheader', { name: 'Criterion' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: 'Met' })).toBeInTheDocument();
    });

    it('no visible regression vs the react-markdown baseline — named parity snapshot (§I2)', async () => {
      const coreBaseline = renderBaseline(CORE_CORPUS);
      const coreBaselineSummary = extractStructuralSummary(
        coreBaseline.container,
      );
      coreBaseline.unmount();

      const coreMigrated = renderMigrated(CORE_CORPUS);
      // CORE_CORPUS has a fenced code block. Post-ID-145.46 the `code`
      // override renders plain markup synchronously (no Shiki lazy-load), so
      // this settle() is no longer strictly required for this corpus —
      // kept as a harmless defensive flush.
      await settle();
      const coreMigratedSummary = extractStructuralSummary(
        coreMigrated.container,
      );
      coreMigrated.unmount();

      const reviewBaseline = renderBaseline(REVIEW_STYLE_CORPUS);
      const reviewBaselineSummary = extractStructuralSummary(
        reviewBaseline.container,
      );
      reviewBaseline.unmount();

      const reviewMigrated = renderMigrated(REVIEW_STYLE_CORPUS);
      await settle(); // REVIEW_STYLE_CORPUS also has a fenced code block — same defensive-flush note as above
      const reviewMigratedSummary = extractStructuralSummary(
        reviewMigrated.container,
      );
      reviewMigrated.unmount();

      // The real regression gate: the migrated (Streamdown) structural
      // content must equal the incumbent (react-markdown) baseline's, for
      // both the core enumerated corpus and the review/response-history
      // style corpus.
      expect(coreMigratedSummary).toEqual(coreBaselineSummary);
      expect(reviewMigratedSummary).toEqual(reviewBaselineSummary);

      // ID-145.46 suite-breaker fix, asserted explicitly (not just folded
      // into the deep-equal above): code must never render Shiki-highlighted
      // (the async chunk import is what leaked act() warnings and broke the
      // suite), and bold must render a real `<strong>` tag (Streamdown's
      // un-overridden default is a non-semantic `<span>`).
      expect(coreMigratedSummary.codeHighlighted).toBe(false);
      expect(coreMigratedSummary.boldTags).toEqual(['STRONG']);
      expect(reviewMigratedSummary.codeHighlighted).toBe(false);

      const qaPairMigrated = renderMigrated(QA_PAIR_CORPUS);
      const qaPairMigratedSummary = extractStructuralSummary(
        qaPairMigrated.container,
      );
      qaPairMigrated.unmount();

      // The named, stored rendered-output snapshot fixture (§I2): documents
      // baseline-vs-migrated parity for the core + review corpora, plus the
      // migrated-only structure for the QA-pair corpus (its internal `.md`
      // link deliberately resolves to a different, but not blocked, href
      // than the un-hardened baseline — asserted explicitly above, not
      // diffed here).
      const report = {
        core: { baseline: coreBaselineSummary, migrated: coreMigratedSummary },
        reviewStyle: {
          baseline: reviewBaselineSummary,
          migrated: reviewMigratedSummary,
        },
        qaPairStyle: { migrated: qaPairMigratedSummary },
      };
      expect(JSON.stringify(report, null, 2)).toMatchFileSnapshot(
        '__snapshots__/content-renderer-streamdown-parity.snapshot',
      );
    });

    it('preserves the plain-text fallback for non-markdown content (§I2)', () => {
      const text = 'First paragraph\n\nSecond paragraph';
      render(<ContentRenderer content={text} />);
      expect(screen.getByText('First paragraph')).toBeInTheDocument();
      expect(screen.getByText('Second paragraph')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });
});
