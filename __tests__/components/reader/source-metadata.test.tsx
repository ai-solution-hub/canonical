/**
 * SourceMetadata component tests.
 *
 * Spec: `docs/specs/source-information-spec.md` §8.3.
 *
 * Phase 4 adds role-gated classification confidence + kitchen-sink AI-
 * mechanism leakage regression. Phase 5 adds feed-article dispatch. Phase-
 * specific tests are labelled inline.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('SourceMetadata — accordion header', () => {
  it('renders the trigger with "Source Information" (not "Source Details")', () => {
    render(
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
    render(
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
    render(
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
    render(
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
    render(
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
    render(
      <SourceMetadata
        contentType="q_a_pair"
        platform={null}
        metadata={{}}
        answerStandard="yes"
      />,
    );
    // Accordion trigger is present even with minimal data.
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
    render(
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
    // NOT the raw pipeline identifier.
    expect(screen.queryByText('markdown_file')).toBeNull();
    expect(screen.getByText('Ingestion date')).toBeInTheDocument();
    expect(screen.getByText('20/04/2026')).toBeInTheDocument();
  });

  it('detects markdown via original_format when ingestion_source is absent', async () => {
    render(
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
    render(
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
    render(
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
    render(
      <SourceMetadata
        contentType="article"
        platform={null}
        metadata={{ extraction_source: 'readability' }}
        sourceUrl={long}
      />,
    );
    await openAccordion();
    // The link text is truncated to 60 chars with ellipsis, but the href
    // retains the full URL.
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', long);
    expect((link.textContent ?? '').endsWith('…')).toBe(true);
  });
});

describe('SourceMetadata — PDF and email', () => {
  it('renders Pages for PDFs', async () => {
    render(
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
    render(
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
    render(
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
    render(
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
