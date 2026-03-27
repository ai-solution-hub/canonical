/**
 * TemplateSelector Component Tests
 *
 * Tests rendering, selection, keyboard navigation, and WCAG compliance
 * for the content creation template selector.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateSelector } from '@/components/create-content/template-selector';
import type { ContentTemplate } from '@/lib/content/content-templates';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockTemplates: ContentTemplate[] = [
  {
    id: 'policy',
    slug: 'policy',
    name: 'Policy Document',
    description: 'Company policy with scope and compliance',
    contentType: 'policy',
    titleTemplate: '',
    contentTemplate: '<h2>Policy Statement</h2>',
    suggestedDomain: 'Governance & Compliance',
    defaultTags: ['policy'],
  },
  {
    id: 'case-study',
    slug: 'case-study',
    name: 'Case Study',
    description: 'Client project with outcomes',
    contentType: 'case_study',
    titleTemplate: '',
    contentTemplate: '<h2>Client and Context</h2>',
    suggestedDomain: 'Track Record',
    defaultTags: ['case-study'],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateSelector', () => {
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
  });

  describe('rendering', () => {
    it('renders all templates plus a Blank option', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      expect(screen.getByText('Blank')).toBeInTheDocument();
      expect(screen.getByText('Policy Document')).toBeInTheDocument();
      expect(screen.getByText('Case Study')).toBeInTheDocument();
    });

    it('displays template descriptions', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      expect(
        screen.getByText('Company policy with scope and compliance'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Client project with outcomes'),
      ).toBeInTheDocument();
    });

    it('renders a "Start from a template" label', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      expect(screen.getByText('Start from a template')).toBeInTheDocument();
    });

    it('renders Blank description text', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      expect(screen.getByText('Start with an empty form')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('clicking a template calls onSelect with the template', async () => {
      const user = userEvent.setup();

      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      await user.click(screen.getByText('Policy Document'));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(mockTemplates[0]);
    });

    it('clicking Blank calls onSelect with null', async () => {
      const user = userEvent.setup();

      render(
        <TemplateSelector
          templates={mockTemplates}
          selectedId="policy"
          onSelect={onSelect}
        />,
      );

      await user.click(screen.getByText('Blank'));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(null);
    });

    it('selected template has aria-checked=true', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          selectedId="policy"
          onSelect={onSelect}
        />,
      );

      const policyButton = screen.getByText('Policy Document').closest('button');
      expect(policyButton).toHaveAttribute('aria-checked', 'true');

      const caseStudyButton = screen.getByText('Case Study').closest('button');
      expect(caseStudyButton).toHaveAttribute('aria-checked', 'false');
    });

    it('Blank is selected by default when no selectedId is provided', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      const blankButton = screen.getByText('Blank').closest('button');
      expect(blankButton).toHaveAttribute('aria-checked', 'true');
    });

    it('Blank is not selected when a template is selected', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          selectedId="case-study"
          onSelect={onSelect}
        />,
      );

      const blankButton = screen.getByText('Blank').closest('button');
      expect(blankButton).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('accessibility', () => {
    it('uses a radiogroup role', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    });

    it('radiogroup has aria-labelledby pointing to the label', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      const radiogroup = screen.getByRole('radiogroup');
      expect(radiogroup).toHaveAttribute('aria-labelledby', 'template-selector-label');
    });

    it('each option has role=radio', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      const radios = screen.getAllByRole('radio');
      // Blank + 2 templates = 3
      expect(radios.length).toBe(3);
    });

    it('all buttons have type=button to prevent form submission', () => {
      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      const radios = screen.getAllByRole('radio');
      for (const radio of radios) {
        expect(radio).toHaveAttribute('type', 'button');
      }
    });
  });

  describe('keyboard navigation', () => {
    it('Tab moves focus to template buttons', async () => {
      const user = userEvent.setup();

      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      await user.tab();
      const blankButton = screen.getByText('Blank').closest('button');
      expect(blankButton).toHaveFocus();

      await user.tab();
      const policyButton = screen.getByText('Policy Document').closest('button');
      expect(policyButton).toHaveFocus();
    });

    it('Enter activates a focused template', async () => {
      const user = userEvent.setup();

      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      // Tab to Blank, then to Policy Document
      await user.tab();
      await user.tab();
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith(mockTemplates[0]);
    });

    it('Space activates a focused template', async () => {
      const user = userEvent.setup();

      render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
        />,
      );

      // Tab to Blank
      await user.tab();
      await user.keyboard(' ');

      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  describe('className prop', () => {
    it('applies custom className to the container', () => {
      const { container } = render(
        <TemplateSelector
          templates={mockTemplates}
          onSelect={onSelect}
          className="my-custom-class"
        />,
      );

      expect(container.firstElementChild).toHaveClass('my-custom-class');
    });
  });

  describe('empty templates', () => {
    it('renders only the Blank option when templates array is empty', () => {
      render(
        <TemplateSelector
          templates={[]}
          onSelect={onSelect}
        />,
      );

      expect(screen.getByText('Blank')).toBeInTheDocument();
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBe(1);
    });
  });
});
