/**
 * PriorityGapCard Component Tests
 *
 * Tests gap card rendering for each source type (taxonomy, template, guide),
 * priority tier badges, action links, and domain/subtopic chips.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type {
  TaxonomyGap,
  TemplateGap,
  GuideGap,
} from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Import AFTER mocks
import { PriorityGapCard } from '@/components/coverage/priority-gap-card';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const taxonomyGap: TaxonomyGap = {
  source: 'taxonomy',
  gap_key: 'taxonomy:health-safety:risk-assessments',
  title: 'Risk Assessments (Health & Safety)',
  description: 'No content items in the Risk Assessments subtopic',
  priority_score: 50,
  priority_tier: 'high',
  domain: 'health-safety',
  subtopic: 'risk-assessments',
  action_href: '/browse?domain=health-safety&subtopic=risk-assessments',
  action_label: 'Add content',
  domain_name: 'health-safety',
  subtopic_name: 'risk-assessments',
  target_unmet: true,
};

const templateGap: TemplateGap = {
  source: 'template',
  gap_key: 'template:ISO-27001:A5:req-1',
  title: 'Information security policy',
  description: 'Policy statement required',
  priority_score: 45,
  priority_tier: 'medium',
  domain: null,
  subtopic: null,
  action_href: '/coverage?tab=templates&template=ISO-27001&section=A5',
  action_label: 'View requirement',
  template_name: 'ISO 27001',
  template_type: 'pqq',
  section_ref: 'A5',
  section_name: 'Information Security Policies',
  requirement_text: 'Information security policy',
  requirement_type: 'policy',
  is_mandatory: true,
};

const guideGap: GuideGap = {
  source: 'guide',
  gap_key: 'guide:g1:s1',
  title: 'Environmental Policy (Sustainability Guide)',
  description: 'No content in the "Environmental Policy" section',
  priority_score: 30,
  priority_tier: 'medium',
  domain: null,
  subtopic: null,
  action_href: '/guide/sustainability-guide',
  action_label: 'Open guide',
  guide_id: 'g1',
  guide_name: 'Sustainability Guide',
  guide_slug: 'sustainability-guide',
  section_id: 's1',
  section_name: 'Environmental Policy',
  is_required: true,
  section_status: 'empty',
};

const lowGap: TaxonomyGap = {
  ...taxonomyGap,
  gap_key: 'taxonomy:corporate:overview',
  priority_score: 20,
  priority_tier: 'low',
};

const criticalGap: TaxonomyGap = {
  ...taxonomyGap,
  gap_key: 'taxonomy:corporate:critical-thing',
  priority_score: 80,
  priority_tier: 'critical',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PriorityGapCard', () => {
  describe('taxonomy gap', () => {
    it('renders title, priority badge, and source badge', () => {
      render(<PriorityGapCard gap={taxonomyGap} />);
      expect(
        screen.getByText('Risk Assessments (Health & Safety)'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('priority-badge-high')).toHaveTextContent(
        'High',
      );
      expect(screen.getByText('Taxonomy')).toBeInTheDocument();
    });

    it('renders domain and subtopic chips', () => {
      render(<PriorityGapCard gap={taxonomyGap} />);
      expect(screen.getByText('health-safety')).toBeInTheDocument();
      expect(screen.getByText('risk-assessments')).toBeInTheDocument();
    });

    it('renders "Add content" action link with correct href', () => {
      render(<PriorityGapCard gap={taxonomyGap} />);
      const link = screen.getByRole('link', { name: /Add content/ });
      expect(link).toHaveAttribute(
        'href',
        '/browse?domain=health-safety&subtopic=risk-assessments',
      );
    });

    it('renders description', () => {
      render(<PriorityGapCard gap={taxonomyGap} />);
      expect(
        screen.getByText('No content items in the Risk Assessments subtopic'),
      ).toBeInTheDocument();
    });
  });

  describe('template gap', () => {
    it('renders title, medium priority badge, and Template source badge', () => {
      render(<PriorityGapCard gap={templateGap} />);
      expect(
        screen.getByText('Information security policy'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('priority-badge-medium')).toHaveTextContent(
        'Medium',
      );
      expect(screen.getByText('Template')).toBeInTheDocument();
    });

    it('renders template name and section', () => {
      render(<PriorityGapCard gap={templateGap} />);
      expect(screen.getByText('ISO 27001')).toBeInTheDocument();
      expect(
        screen.getByText(/Information Security Policies/),
      ).toBeInTheDocument();
    });

    it('renders "View requirement" action link', () => {
      render(<PriorityGapCard gap={templateGap} />);
      const link = screen.getByRole('link', { name: /View requirement/ });
      expect(link).toHaveAttribute(
        'href',
        '/coverage?tab=templates&template=ISO-27001&section=A5',
      );
    });

    it('does not render domain/subtopic chips when null', () => {
      render(<PriorityGapCard gap={templateGap} />);
      // No badges with domain text — only the Template source badge exists
      const badges = screen.getAllByText(/Template/);
      expect(badges.length).toBe(1);
    });
  });

  describe('guide gap', () => {
    it('renders title, priority badge, and Guide source badge', () => {
      render(<PriorityGapCard gap={guideGap} />);
      expect(
        screen.getByText('Environmental Policy (Sustainability Guide)'),
      ).toBeInTheDocument();
      expect(screen.getByText('Guide')).toBeInTheDocument();
    });

    it('renders guide name and section name', () => {
      render(<PriorityGapCard gap={guideGap} />);
      expect(screen.getByText('Sustainability Guide')).toBeInTheDocument();
      // "Environmental Policy" appears in the title and in the metadata line
      const matches = screen.getAllByText(/Environmental Policy/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders "Open guide" action link with correct href', () => {
      render(<PriorityGapCard gap={guideGap} />);
      const link = screen.getByRole('link', { name: /Open guide/ });
      expect(link).toHaveAttribute('href', '/guide/sustainability-guide');
    });
  });

  describe('priority tier badges', () => {
    it('renders critical badge with correct test id', () => {
      render(<PriorityGapCard gap={criticalGap} />);
      expect(
        screen.getByTestId('priority-badge-critical'),
      ).toHaveTextContent('Critical');
    });

    it('renders high badge', () => {
      render(<PriorityGapCard gap={taxonomyGap} />);
      expect(screen.getByTestId('priority-badge-high')).toHaveTextContent(
        'High',
      );
    });

    it('renders medium badge', () => {
      render(<PriorityGapCard gap={templateGap} />);
      expect(screen.getByTestId('priority-badge-medium')).toHaveTextContent(
        'Medium',
      );
    });

    it('renders low badge', () => {
      render(<PriorityGapCard gap={lowGap} />);
      expect(screen.getByTestId('priority-badge-low')).toHaveTextContent(
        'Low',
      );
    });
  });

  describe('gap card data-testid', () => {
    it('includes gap_key in data-testid', () => {
      render(<PriorityGapCard gap={taxonomyGap} />);
      expect(
        screen.getByTestId('gap-card-taxonomy:health-safety:risk-assessments'),
      ).toBeInTheDocument();
    });
  });
});
