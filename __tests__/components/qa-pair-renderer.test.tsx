/**
 * QAPairRenderer Component Tests
 *
 * Tests the QAPairRenderer component — markdown rendering for Q&A answer
 * sections, null/empty input handling, visual hierarchy, and regression
 * against plain-text rendering.
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md AC5
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { QAPairRenderer } from '@/components/qa/qa-pair-renderer';

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------

describe('QAPairRenderer', () => {
  it('renders both standard and advanced answers when populated', () => {
    render(
      <QAPairRenderer
        question="What is your quality policy?"
        answerStandard="We follow ISO 9001 standards."
        answerAdvanced="Our QMS covers all operational processes."
      />,
    );

    expect(
      screen.getByText('What is your quality policy?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('We follow ISO 9001 standards.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Our QMS covers all operational processes.'),
    ).toBeInTheDocument();
  });

  it('renders only standard answer when advanced is null', () => {
    render(
      <QAPairRenderer
        question="What is your environmental policy?"
        answerStandard="We minimise environmental impact."
        answerAdvanced={null}
      />,
    );

    expect(
      screen.getByText('We minimise environmental impact.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Our QMS covers all operational processes.'),
    ).not.toBeInTheDocument();
  });

  it('renders only advanced answer when standard is null', () => {
    render(
      <QAPairRenderer
        question="What certifications do you hold?"
        answerStandard={null}
        answerAdvanced="ISO 9001, ISO 14001, and ISO 27001."
      />,
    );

    expect(
      screen.getByText('ISO 9001, ISO 14001, and ISO 27001.'),
    ).toBeInTheDocument();
  });

  it('renders nothing when all inputs are null', () => {
    const { container } = render(
      <QAPairRenderer
        question={null}
        answerStandard={null}
        answerAdvanced={null}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when all inputs are empty strings', () => {
    const { container } = render(
      <QAPairRenderer question="" answerStandard="" answerAdvanced="" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when all inputs are undefined', () => {
    const { container } = render(<QAPairRenderer />);
    expect(container.firstChild).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Markdown rendering
  // -------------------------------------------------------------------------

  it('renders bold markdown in standard answer', () => {
    render(
      <QAPairRenderer
        answerStandard={'We have **comprehensive** quality policies.'}
      />,
    );

    // react-markdown renders **text** as <strong>
    const strong = document.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent('comprehensive');
  });

  it('renders unordered list markdown in answers', () => {
    render(
      <QAPairRenderer
        answerStandard={
          'Key policies:\n\n- Quality management\n- Environmental management\n- Health and safety'
        }
      />,
    );

    // react-markdown renders - items as <li>
    const listItems = document.querySelectorAll('li');
    expect(listItems.length).toBe(3);
    expect(listItems[0]).toHaveTextContent('Quality management');
  });

  it('renders ordered list markdown in answers', () => {
    render(
      <QAPairRenderer
        answerAdvanced={
          'Compliance steps:\n\n1. Identify requirements\n2. Implement controls\n3. Monitor and review'
        }
      />,
    );

    const listItems = document.querySelectorAll('li');
    expect(listItems.length).toBe(3);
    expect(listItems[0]).toHaveTextContent('Identify requirements');
  });

  it('renders heading markdown in answers', () => {
    render(
      <QAPairRenderer
        answerStandard={'## Overview\n\nOur approach covers all areas.'}
      />,
    );

    const heading = document.querySelector('h2');
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('Overview');
  });

  it('renders table markdown in answers via remark-gfm', () => {
    render(
      <QAPairRenderer
        answerStandard={
          '| Certification | Year |\n|---|---|\n| ISO 9001 | 2024 |\n| ISO 14001 | 2023 |'
        }
      />,
    );

    const table = document.querySelector('table');
    expect(table).toBeInTheDocument();
    const cells = document.querySelectorAll('td');
    expect(cells.length).toBeGreaterThanOrEqual(4);
  });

  it('renders code blocks in answers', () => {
    render(
      <QAPairRenderer
        answerAdvanced={'Use the following command:\n\n```\nnpm install\n```'}
      />,
    );

    // ContentRenderer detects ``` as markdown and renders via react-markdown
    const code = document.querySelector('code');
    expect(code).toBeInTheDocument();
    expect(code).toHaveTextContent('npm install');
  });

  // -------------------------------------------------------------------------
  // Plain-text regression
  // -------------------------------------------------------------------------

  it('renders plain text identically to pre-Phase-3 display', () => {
    render(
      <QAPairRenderer answerStandard="This is a plain text answer with no markdown syntax." />,
    );

    // ContentRenderer's plain-text path splits on \n\n and renders <p> tags
    expect(
      screen.getByText('This is a plain text answer with no markdown syntax.'),
    ).toBeInTheDocument();
  });

  it('renders multi-paragraph plain text as separate paragraphs', () => {
    render(
      <QAPairRenderer
        answerStandard={'First paragraph.\n\nSecond paragraph.'}
      />,
    );

    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Question display
  // -------------------------------------------------------------------------

  it('renders question as a visually prominent element', () => {
    const { container } = render(
      <QAPairRenderer question="What is your quality policy?" />,
    );

    const questionEl = container.querySelector('.font-medium');
    expect(questionEl).toBeInTheDocument();
    expect(questionEl).toHaveTextContent('What is your quality policy?');
  });

  // -------------------------------------------------------------------------
  // className passthrough
  // -------------------------------------------------------------------------

  it('applies custom className to the outer wrapper', () => {
    const { container } = render(
      <QAPairRenderer answerStandard="Test answer." className="custom-class" />,
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });
});
