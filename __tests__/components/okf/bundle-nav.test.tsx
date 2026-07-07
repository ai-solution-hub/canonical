import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BundleNav } from '@/components/okf/bundle-nav';
import type { OkfBundleGraphNode, OkfBundleNavTheme } from '@/lib/query/okf';

const THEMES: OkfBundleNavTheme[] = [
  {
    heading: 'Pricing',
    level: 2,
    concepts: [
      {
        title: 'Standard tier',
        path: 'topics/pricing/standard',
        description: 'The standard tier.',
      },
      {
        title: 'Enterprise tier',
        path: 'topics/pricing/enterprise',
        description: 'The enterprise tier.',
      },
    ],
    children: [],
  },
  {
    heading: 'Security',
    level: 2,
    concepts: [
      {
        title: 'SOC 2',
        path: 'topics/security/soc2',
        description: 'Our SOC 2 posture.',
      },
    ],
    children: [],
  },
];

const FALLBACK_NODES: OkfBundleGraphNode[] = [
  {
    data: {
      id: 'tables/orders',
      label: 'Orders',
      type: 'BigQuery Table',
      description: 'One row per order.',
      resource: '',
      tags: [],
      size: 30,
    },
  },
];

describe('BundleNav', () => {
  it('renders theme headings collapsed — concept rows are not visible until expanded', () => {
    render(
      <BundleNav
        themes={THEMES}
        fallbackNodes={[]}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.queryByText('Standard tier')).not.toBeInTheDocument();
  });

  it('expanding a theme reveals its concepts as title — description rows', () => {
    render(
      <BundleNav
        themes={THEMES}
        fallbackNodes={[]}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Pricing'));

    expect(screen.getByText('Standard tier')).toBeInTheDocument();
    expect(screen.getByText(/The standard tier\./)).toBeInTheDocument();
    expect(screen.getByText('Enterprise tier')).toBeInTheDocument();
  });

  it('clicking a concept row calls onSelectConcept with its bundle-relative path', () => {
    const onSelectConcept = vi.fn();
    render(
      <BundleNav
        themes={THEMES}
        fallbackNodes={[]}
        selectedConceptId={null}
        onSelectConcept={onSelectConcept}
      />,
    );

    fireEvent.click(screen.getByText('Pricing'));
    fireEvent.click(screen.getByText('Standard tier'));

    expect(onSelectConcept).toHaveBeenCalledWith('topics/pricing/standard');
  });

  it('falls back to grouping graph nodes by type when index.md is absent', () => {
    render(
      <BundleNav
        themes={null}
        fallbackNodes={FALLBACK_NODES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    expect(screen.getByText('BigQuery Table')).toBeInTheDocument();
    fireEvent.click(screen.getByText('BigQuery Table'));
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('renders an empty state when there are no themes and no fallback nodes', () => {
    render(
      <BundleNav
        themes={null}
        fallbackNodes={[]}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/No concepts in this bundle yet/),
    ).toBeInTheDocument();
  });
});
