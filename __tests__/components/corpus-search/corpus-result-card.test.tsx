/**
 * CorpusResultCard — polymorphic per-`kind` result card tests (ID-135.7).
 *
 * Behaviour-first (test-philosophy.md): asserts each discriminated-union
 * `kind` renders its own content set and links to the correct destination
 * (BI-13/BI-14), that the kind label carries text (not colour-only, BI-4),
 * and that no similarity/score/model/profile field is ever rendered
 * (BI-3, AI-invisible infrastructure).
 *
 * Spec: PRODUCT.md BI-3, BI-4, BI-12, BI-13, BI-14.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { CorpusResultCard } from '@/components/corpus-search/corpus-result-card';
import type { CorpusSearchResult } from '@/types/corpus-search';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const REFERENCE_ID = '22222222-2222-4222-8222-222222222222';

function makeAnswer(
  overrides: Partial<Extract<CorpusSearchResult, { kind: 'answer' }>> = {},
): CorpusSearchResult {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    kind: 'answer',
    title: 'What is the minimum PPE requirement on-site?',
    answerSnippet: 'Hard hats and high-vis vests are mandatory at all times.',
    scopeTags: ['procurement'],
    primaryDomain: 'health-and-safety',
    primarySubtopic: 'ppe',
    ...overrides,
  };
}

function makeDocument(
  overrides: Partial<Extract<CorpusSearchResult, { kind: 'document' }>> = {},
): CorpusSearchResult {
  return {
    id: DOCUMENT_ID,
    kind: 'document',
    title: 'Site Safety Policy 2026',
    summary: 'Outlines mandatory safety procedures for all site visitors.',
    primaryDomain: 'health-and-safety',
    primarySubtopic: 'policy',
    ...overrides,
  };
}

function makeReference(
  overrides: Partial<Extract<CorpusSearchResult, { kind: 'reference' }>> = {},
): CorpusSearchResult {
  return {
    id: REFERENCE_ID,
    kind: 'reference',
    title: 'UK SMB Procurement Trends 2026',
    sourceUrl: 'https://example.com/procurement-trends',
    ...overrides,
  };
}

describe('CorpusResultCard', () => {
  describe('answer kind', () => {
    it('renders the question as the title and the answer snippet as the summary', () => {
      render(<CorpusResultCard result={makeAnswer()} />);
      expect(
        screen.getByText('What is the minimum PPE requirement on-site?'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Hard hats and high-vis vests are mandatory at all times.',
        ),
      ).toBeInTheDocument();
    });

    it('renders scope and domain badges', () => {
      render(<CorpusResultCard result={makeAnswer()} />);
      expect(screen.getByText('procurement')).toBeInTheDocument();
      expect(screen.getByText('health-and-safety')).toBeInTheDocument();
      expect(screen.getByText('ppe')).toBeInTheDocument();
    });

    it('links to /library', () => {
      render(<CorpusResultCard result={makeAnswer()} />);
      expect(screen.getByRole('link')).toHaveAttribute('href', '/library');
    });
  });

  describe('document kind', () => {
    it('renders the classified title and summary', () => {
      render(<CorpusResultCard result={makeDocument()} />);
      expect(screen.getByText('Site Safety Policy 2026')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Outlines mandatory safety procedures for all site visitors.',
        ),
      ).toBeInTheDocument();
    });

    it('renders primary_domain/primary_subtopic badges', () => {
      render(<CorpusResultCard result={makeDocument()} />);
      expect(screen.getByText('health-and-safety')).toBeInTheDocument();
      expect(screen.getByText('policy')).toBeInTheDocument();
    });

    it('links to /documents/[id] (Surface B)', () => {
      render(<CorpusResultCard result={makeDocument()} />);
      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        `/documents/${DOCUMENT_ID}`,
      );
    });

    it('omits badges when domain/subtopic are null', () => {
      render(
        <CorpusResultCard
          result={makeDocument({
            primaryDomain: null,
            primarySubtopic: null,
          })}
        />,
      );
      expect(screen.queryByText('health-and-safety')).not.toBeInTheDocument();
      expect(screen.queryByText('policy')).not.toBeInTheDocument();
    });
  });

  describe('reference kind', () => {
    it('renders the reference title and source', () => {
      render(<CorpusResultCard result={makeReference()} />);
      expect(
        screen.getByText('UK SMB Procurement Trends 2026'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('https://example.com/procurement-trends'),
      ).toBeInTheDocument();
    });

    it('links to /reference/[id]', () => {
      render(<CorpusResultCard result={makeReference()} />);
      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        `/reference/${REFERENCE_ID}`,
      );
    });

    it('omits the source line when sourceUrl is null', () => {
      render(<CorpusResultCard result={makeReference({ sourceUrl: null })} />);
      expect(
        screen.queryByText('https://example.com/procurement-trends'),
      ).not.toBeInTheDocument();
    });
  });

  describe('kind label (BI-4, text/icon not colour-only)', () => {
    it('shows the "Answer" text label', () => {
      render(<CorpusResultCard result={makeAnswer()} />);
      expect(screen.getByText('Answer')).toBeInTheDocument();
    });

    it('shows the "Document" text label', () => {
      render(<CorpusResultCard result={makeDocument()} />);
      expect(screen.getByText('Document')).toBeInTheDocument();
    });

    it('shows the "Reference" text label', () => {
      render(<CorpusResultCard result={makeReference()} />);
      expect(screen.getByText('Reference')).toBeInTheDocument();
    });
  });

  describe('AI-invisible infrastructure (BI-3)', () => {
    it('never renders a similarity/score/model/profile field for any kind', () => {
      const { unmount: unmountAnswer } = render(
        <CorpusResultCard result={makeAnswer()} />,
      );
      expect(
        screen.queryByText(/similarity|score|model|profile/i),
      ).not.toBeInTheDocument();
      unmountAnswer();

      const { unmount: unmountDocument } = render(
        <CorpusResultCard result={makeDocument()} />,
      );
      expect(
        screen.queryByText(/similarity|score|model|profile/i),
      ).not.toBeInTheDocument();
      unmountDocument();

      render(<CorpusResultCard result={makeReference()} />);
      expect(
        screen.queryByText(/similarity|score|model|profile/i),
      ).not.toBeInTheDocument();
    });
  });
});
