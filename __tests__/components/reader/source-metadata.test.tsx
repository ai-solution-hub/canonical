/**
 * SourceMetadata component tests.
 *
 * Spec: `docs/specs/source-information-spec.md` §8.3.
 *
 * Role gating (Phase 4) uses `vi.mock('@/hooks/use-user-role', ...)`; every
 * render is wrapped in `createQueryWrapper().Wrapper` because `useUserRole`
 * lives inside `SourceMetadata` as of Phase 4.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '../../helpers/query-wrapper';

// Role mock — default to viewer (canEdit: false). Tests that need editor
// override by mutating `useUserRoleMock.mockReturnValue(...)`.
const useUserRoleMock = vi.fn(() => ({
  role: 'viewer' as 'viewer' | 'editor' | 'admin' | null,
  loading: false,
  canEdit: false,
  canAdmin: false,
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => useUserRoleMock(),
}));

import { SourceMetadata } from '@/components/reader/source-metadata';

/**
 * Open the "Source Information" accordion so its content is visible.
 * Radix's <Accordion type="single" collapsible> starts collapsed; test
 * content lives inside a region that only mounts after expansion.
 */
async function openAccordion() {
  const trigger = screen.queryByRole('button', { name: 'Source Information' });
  if (trigger) {
    await userEvent.click(trigger);
  }
}

function renderWithProviders(ui: React.ReactElement) {
  const { Wrapper } = createQueryWrapper();
  return render(ui, { wrapper: Wrapper });
}

beforeEach(() => {
  useUserRoleMock.mockReturnValue({
    role: 'viewer',
    loading: false,
    canEdit: false,
    canAdmin: false,
  });
});

describe('SourceMetadata — accordion header', () => {
  it('renders the trigger with "Source Information" (not "Source Details")', () => {
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        answerStandard="yes"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Source Information' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Source Details')).toBeNull();
  });
});

describe('SourceMetadata — Q&A pair', () => {
  it('renders Source document, Section, Answer variants, Imported on, and No source URL', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{
          section_name: 'Information Security',
          import_batch: 'bid-library-20260422-070729',
        }}
        sourceFile="Foo Bar.docx"
        sourceUrl=""
        answerStandard="yes"
        answerAdvanced={null}
      />,
    );
    await openAccordion();
    expect(screen.getByText('Source document')).toBeInTheDocument();
    expect(screen.getByText('Foo Bar.docx')).toBeInTheDocument();
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('Information Security')).toBeInTheDocument();
    expect(screen.getByText('Answer variants')).toBeInTheDocument();
    expect(screen.getByText('Standard only')).toBeInTheDocument();
    expect(screen.getByText('Imported on')).toBeInTheDocument();
    expect(screen.getByText('22/04/2026')).toBeInTheDocument();
    expect(screen.getByText('No source URL')).toBeInTheDocument();
  });

  it('renders Answer variants "Standard + Advanced" when both columns populated', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        sourceFile="Q.docx"
        answerStandard="yes"
        answerAdvanced="yes (detailed)"
      />,
    );
    await openAccordion();
    expect(screen.getByText('Standard + Advanced')).toBeInTheDocument();
  });

  it('renders Answer variants "Advanced only" when only advanced is populated', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        answerStandard={null}
        answerAdvanced="yes (detailed)"
      />,
    );
    await openAccordion();
    expect(screen.getByText('Advanced only')).toBeInTheDocument();
  });

  it('hides "Imported on" row when import_batch is unparseable', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{ import_batch: 'nonsense' }}
        sourceFile="Q.docx"
        answerStandard="yes"
      />,
    );
    await openAccordion();
    expect(screen.queryByText('Imported on')).toBeNull();
  });

  it('still renders accordion for a bare Q&A (no metadata, only answer_standard)', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        answerStandard="yes"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Source Information' }),
    ).toBeInTheDocument();
    await openAccordion();
    expect(screen.getByText('Standard only')).toBeInTheDocument();
    expect(screen.getByText('No source URL')).toBeInTheDocument();
  });
});

describe('SourceMetadata — Markdown article', () => {
  it('renders Source file, Source folder, Ingestion source "Markdown upload", and Ingestion date', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{
          ingestion_source: 'markdown_file',
          source_folder: 'example-client-markdown-reingest',
        }}
        sourceFile="04-named-clients-and-case-studies.md"
        createdAt="2026-04-20T10:00:00Z"
      />,
    );
    await openAccordion();
    expect(screen.getByText('Source file')).toBeInTheDocument();
    expect(
      screen.getByText('04-named-clients-and-case-studies.md'),
    ).toBeInTheDocument();
    expect(screen.getByText('Source folder')).toBeInTheDocument();
    expect(screen.getByText('example-client-markdown-reingest')).toBeInTheDocument();
    expect(screen.getByText('Ingestion source')).toBeInTheDocument();
    expect(screen.getByText('Markdown upload')).toBeInTheDocument();
    expect(screen.queryByText('markdown_file')).toBeNull();
    expect(screen.getByText('Ingestion date')).toBeInTheDocument();
    expect(screen.getByText('20/04/2026')).toBeInTheDocument();
  });

  it('detects markdown via original_format when ingestion_source is absent', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{ original_format: 'markdown' }}
        sourceFile="file.md"
        createdAt="2026-04-20T10:00:00Z"
      />,
    );
    await openAccordion();
    expect(screen.getByText('Source file')).toBeInTheDocument();
    expect(screen.getByText('file.md')).toBeInTheDocument();
  });
});

describe('SourceMetadata — Generic web article', () => {
  it('renders extraction_source, og_description, clickable source URL', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{
          extraction_source: 'readability',
          og_description: 'A description',
          og_type: 'article',
          reader_html: '<p>…</p>',
        }}
        sourceUrl="https://example.com/article"
      />,
    );
    await openAccordion();
    expect(screen.getByText('Extraction method')).toBeInTheDocument();
    expect(screen.getByText('readability')).toBeInTheDocument();
    expect(screen.getByText('OG description')).toBeInTheDocument();
    expect(screen.getByText('A description')).toBeInTheDocument();
    expect(screen.getByText('OG type')).toBeInTheDocument();
    expect(screen.getByText('article')).toBeInTheDocument();
    expect(screen.getByText('Reader view')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: 'https://example.com/article',
    });
    expect(link).toHaveAttribute('href', 'https://example.com/article');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits accordion entirely when nothing renders', () => {
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{}}
        sourceUrl=""
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Source Information' }),
    ).toBeNull();
  });

  it('truncates long source URLs with an ellipsis', async () => {
    const long = 'https://example.com/' + 'a'.repeat(100);
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{ extraction_source: 'readability' }}
        sourceUrl={long}
      />,
    );
    await openAccordion();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', long);
    expect((link.textContent ?? '').endsWith('…')).toBe(true);
  });
});

describe('SourceMetadata — PDF and email', () => {
  it('renders Pages for PDFs', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="pdf"
        platform={null}
        metadata={{ page_count: 17 }}
        sourceUrl="https://example.com/doc.pdf"
      />,
    );
    await openAccordion();
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('renders Newsletter, Subject, From for email platform', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform="email"
        metadata={{
          newsletter_name: 'Schools Week',
          email_subject: 'Weekly roundup',
          email_from: 'news@schoolsweek.co.uk',
        }}
      />,
    );
    await openAccordion();
    expect(screen.getByText('Newsletter')).toBeInTheDocument();
    expect(screen.getByText('Schools Week')).toBeInTheDocument();
    expect(screen.getByText('Subject')).toBeInTheDocument();
    expect(screen.getByText('Weekly roundup')).toBeInTheDocument();
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('news@schoolsweek.co.uk')).toBeInTheDocument();
  });
});

describe('SourceMetadata — ingestion source label map (Phase 3, AC-3)', () => {
  it('never renders the raw "markdown_file" identifier', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{ ingestion_source: 'markdown_file' }}
        sourceFile="f.md"
      />,
    );
    await openAccordion();
    const region = screen.getByRole('region');
    expect(within(region).queryByText('markdown_file')).toBeNull();
    expect(within(region).getByText('Markdown upload')).toBeInTheDocument();
  });

  it('falls through to raw string for unknown ingestion_source (fail-safe)', async () => {
    renderWithProviders(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{ ingestion_source: 'future_unknown' }}
      />,
    );
    await openAccordion();
    expect(screen.getByText('future_unknown')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — role-gated classification confidence (AC-5)
// ---------------------------------------------------------------------------

describe('SourceMetadata — classification_confidence role-gate (AC-5)', () => {
  it('hides Classification confidence row for viewers', async () => {
    useUserRoleMock.mockReturnValue({
      role: 'viewer',
      loading: false,
      canEdit: false,
      canAdmin: false,
    });
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        sourceFile="Q.docx"
        classificationConfidence={0.7}
        answerStandard="yes"
      />,
    );
    await openAccordion();
    expect(screen.queryByText('Classification confidence')).toBeNull();
    expect(screen.queryByText('70%')).toBeNull();
  });

  it('renders Classification confidence as "70%" for editors', async () => {
    useUserRoleMock.mockReturnValue({
      role: 'editor',
      loading: false,
      canEdit: true,
      canAdmin: false,
    });
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        sourceFile="Q.docx"
        classificationConfidence={0.7}
        answerStandard="yes"
      />,
    );
    await openAccordion();
    expect(screen.getByText('Classification confidence')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('renders Classification confidence for admins', async () => {
    useUserRoleMock.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        sourceFile="Q.docx"
        classificationConfidence={0.9}
        answerStandard="yes"
      />,
    );
    await openAccordion();
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('hides Classification confidence while role hook is loading', async () => {
    useUserRoleMock.mockReturnValue({
      role: null,
      loading: true,
      canEdit: false,
      canAdmin: false,
    });
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        sourceFile="Q.docx"
        classificationConfidence={0.7}
        answerStandard="yes"
      />,
    );
    await openAccordion();
    expect(screen.queryByText('Classification confidence')).toBeNull();
  });

  it('renders 0% when confidence is 0 and user is editor (renderable per §14.2)', async () => {
    useUserRoleMock.mockReturnValue({
      role: 'editor',
      loading: false,
      canEdit: true,
      canAdmin: false,
    });
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        sourceFile="Q.docx"
        classificationConfidence={0}
        answerStandard="yes"
      />,
    );
    await openAccordion();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('does not render Classification confidence row when confidence is null (even for editor)', async () => {
    useUserRoleMock.mockReturnValue({
      role: 'editor',
      loading: false,
      canEdit: true,
      canAdmin: false,
    });
    renderWithProviders(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        sourceFile="Q.docx"
        classificationConfidence={null}
        answerStandard="yes"
      />,
    );
    await openAccordion();
    expect(screen.queryByText('Classification confidence')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — AI-mechanism leakage regression (AC-7) and sidebar-duplication
// regression (AC-8). Kitchen-sink prop set, both role states.
// Spec §8.3.9.
// ---------------------------------------------------------------------------

describe('SourceMetadata — AI-mechanism leakage regression (AC-7 + AC-8)', () => {
  const kitchenSinkMetadata: Record<string, unknown> = {
    // AI-mechanism keys that MUST NOT surface:
    classification_model: 'claude-opus-4-7',
    classification_tokens_in: 12345,
    classification_tokens_out: 6789,
    classification_reasoning:
      'because the taxonomy says so and the text matches subtopic X',
    embedding_model: 'text-embedding-3-large',
    embedding_dims: 1024,
    classification_cost_usd: 0.042,
    // Legitimate surface keys (these SHOULD render):
    section_name: 'Information Security',
    import_batch: 'bid-library-20260422-070729',
    // AC-8 anti-duplication (sidebar-owned fields; must NOT leak into accordion):
    author_name: 'Alice Example',
    source_domain: 'example.com',
    captured_date: '2026-04-22',
  };

  const kitchenSinkProps = {
    contentType: 'q_a_pair',
    platform: null,
    metadata: kitchenSinkMetadata,
    content: 'short content',
    sourceFile: 'Foo.docx',
    sourceUrl: '',
    classificationConfidence: 0.7,
    answerStandard: 'yes',
    answerAdvanced: null,
  };

  it('Test A (viewer): accordion hides AI-mechanism fields, sidebar fields, and confidence', async () => {
    useUserRoleMock.mockReturnValue({
      role: 'viewer',
      loading: false,
      canEdit: false,
      canAdmin: false,
    });
    renderWithProviders(<SourceMetadata {...kitchenSinkProps} />);
    await openAccordion();

    // Positive sanity: render did execute (legitimate row visible).
    expect(screen.getByText('Information Security')).toBeInTheDocument();

    // AC-7: AI-mechanism leakage assertions.
    expect(screen.queryByText(/claude/i)).toBeNull();
    expect(screen.queryByText(/12345/)).toBeNull();
    expect(screen.queryByText(/6789/)).toBeNull();
    expect(screen.queryByText(/embedding/i)).toBeNull();
    expect(screen.queryByText(/because the taxonomy/i)).toBeNull();
    expect(screen.queryByText(/\$|USD|0\.042/)).toBeNull();
    // Confidence gated off for viewer.
    expect(screen.queryByText('70%')).toBeNull();

    // AC-8: sidebar-duplication assertions.
    expect(screen.queryByText(/Alice Example/)).toBeNull();
    expect(screen.queryByText(/example\.com/)).toBeNull();
    expect(screen.queryByText(/22\/04\/2026/)).not.toBeNull(); // import-batch
    // The import_batch "Imported on" row DOES show "22/04/2026" — that's
    // correct (it's derived, not the raw captured_date). AC-8 is about
    // author_name, source_domain, captured_date being absent, not the
    // rendered date string per se. Captured_date value is "2026-04-22"
    // ISO string — different text than the rendered DD/MM/YYYY from
    // import_batch. The positive-test above uses import_batch parse;
    // a stricter AC-8 assertion is the sidebar-field labels are absent:
    expect(screen.queryByText('Author')).toBeNull();
    expect(screen.queryByText('Source domain')).toBeNull();
    expect(screen.queryByText('Captured date')).toBeNull();
  });

  it('Test B (editor): confidence renders as "70%", AI-mechanism + sidebar fields still hidden', async () => {
    useUserRoleMock.mockReturnValue({
      role: 'editor',
      loading: false,
      canEdit: true,
      canAdmin: false,
    });
    renderWithProviders(<SourceMetadata {...kitchenSinkProps} />);
    await openAccordion();

    // Positive sanity + confidence visible for editor.
    expect(screen.getByText('Information Security')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();

    // AC-7: AI-mechanism leakage assertions — same as viewer.
    expect(screen.queryByText(/claude/i)).toBeNull();
    expect(screen.queryByText(/12345/)).toBeNull();
    expect(screen.queryByText(/6789/)).toBeNull();
    expect(screen.queryByText(/embedding/i)).toBeNull();
    expect(screen.queryByText(/because the taxonomy/i)).toBeNull();
    expect(screen.queryByText(/\$|USD|0\.042/)).toBeNull();
    // No AI branding copy — "Classification confidence" is allowed, but
    // no standalone "AI" label anywhere in the accordion region.
    const region = screen.getByRole('region');
    expect(within(region).queryByText(/^AI$|AI confidence/i)).toBeNull();

    // AC-8: sidebar-duplication assertions.
    expect(screen.queryByText(/Alice Example/)).toBeNull();
    expect(screen.queryByText(/example\.com/)).toBeNull();
    expect(screen.queryByText('Author')).toBeNull();
    expect(screen.queryByText('Source domain')).toBeNull();
    expect(screen.queryByText('Captured date')).toBeNull();
  });
});
