/**
 * ContentOrganisationSection Tests
 *
 * Tests the tabbed wrapper that merges Taxonomy, Tags, and Layers settings
 * sections into a single "Content Organisation" section with three tabs.
 * Also tests legacy section ID mapping in getValidSection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRouter, mockSearchParams } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockSearchParams: { value: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/settings',
  useSearchParams: () => mockSearchParams.value,
}));

vi.mock('@/components/settings/taxonomy-section', () => ({
  TaxonomySection: () => (
    <div data-testid="taxonomy-section">TaxonomySection</div>
  ),
}));

vi.mock('@/components/settings/tags-section', () => ({
  TagsSection: () => <div data-testid="tags-section">TagsSection</div>,
}));

vi.mock('@/components/settings/layers-section', () => ({
  LayersSection: () => <div data-testid="layers-section">LayersSection</div>,
}));

vi.mock('@/components/settings/taxonomy-drift-banner', () => ({
  TaxonomyDriftBanner: () => (
    <div data-testid="taxonomy-drift-banner">TaxonomyDriftBanner</div>
  ),
}));

import { ContentOrganisationSection } from '@/components/settings/content-organisation-section';
import { getValidSection } from '@/components/settings/settings-sidebar';

// ---------------------------------------------------------------------------
// Tests — ContentOrganisationSection
// ---------------------------------------------------------------------------

describe('ContentOrganisationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.value = new URLSearchParams(
      'section=content-organisation',
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the section header and description', () => {
    render(<ContentOrganisationSection />);

    expect(screen.getByText('Content Organisation')).toBeInTheDocument();
    expect(
      screen.getByText(
        'How your knowledge is categorised, tagged, and layered.',
      ),
    ).toBeInTheDocument();
  });

  it('renders all three tabs', () => {
    render(<ContentOrganisationSection />);

    expect(screen.getByRole('tab', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tags' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Depth Levels' }),
    ).toBeInTheDocument();
  });

  it('defaults to the Categories tab and shows TaxonomySection', () => {
    render(<ContentOrganisationSection />);

    const categoriesTab = screen.getByRole('tab', { name: 'Categories' });
    expect(categoriesTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('taxonomy-section')).toBeInTheDocument();
  });

  it('switches to Tags tab and shows TagsSection when clicked', async () => {
    const user = userEvent.setup();
    render(<ContentOrganisationSection />);

    await user.click(screen.getByRole('tab', { name: 'Tags' }));

    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.stringContaining('tab=tags'),
      { scroll: false },
    );
  });

  it('switches to Depth Levels tab and shows LayersSection when clicked', async () => {
    const user = userEvent.setup();
    render(<ContentOrganisationSection />);

    await user.click(screen.getByRole('tab', { name: 'Depth Levels' }));

    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.stringContaining('tab=depth-levels'),
      { scroll: false },
    );
  });

  it('reads tab from URL and activates the correct tab', () => {
    mockSearchParams.value = new URLSearchParams(
      'section=content-organisation&tab=tags',
    );
    render(<ContentOrganisationSection />);

    const tagsTab = screen.getByRole('tab', { name: 'Tags' });
    expect(tagsTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('tags-section')).toBeInTheDocument();
  });

  it('reads depth-levels tab from URL', () => {
    mockSearchParams.value = new URLSearchParams(
      'section=content-organisation&tab=depth-levels',
    );
    render(<ContentOrganisationSection />);

    const depthTab = screen.getByRole('tab', { name: 'Depth Levels' });
    expect(depthTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('layers-section')).toBeInTheDocument();
  });

  it('falls back to defaultTab prop for invalid tab param', () => {
    mockSearchParams.value = new URLSearchParams(
      'section=content-organisation&tab=nonexistent',
    );
    render(<ContentOrganisationSection defaultTab="tags" />);

    const tagsTab = screen.getByRole('tab', { name: 'Tags' });
    expect(tagsTab).toHaveAttribute('data-state', 'active');
  });

  it('respects defaultTab prop when no tab param is in URL', () => {
    mockSearchParams.value = new URLSearchParams(
      'section=content-organisation',
    );
    render(<ContentOrganisationSection defaultTab="depth-levels" />);

    const depthTab = screen.getByRole('tab', { name: 'Depth Levels' });
    expect(depthTab).toHaveAttribute('data-state', 'active');
  });
});

// ---------------------------------------------------------------------------
// Tests — Legacy section ID mapping
// ---------------------------------------------------------------------------

describe('getValidSection — legacy section ID mapping', () => {
  it('maps "taxonomy" to "content-organisation" for admin users', () => {
    expect(getValidSection('taxonomy', true)).toBe('content-organisation');
  });

  it('maps "tags" to "content-organisation" for admin users', () => {
    expect(getValidSection('tags', true)).toBe('content-organisation');
  });

  it('maps "layers" to "content-organisation" for admin users', () => {
    expect(getValidSection('layers', true)).toBe('content-organisation');
  });

  it('returns "content-organisation" directly when passed as param', () => {
    expect(getValidSection('content-organisation', true)).toBe(
      'content-organisation',
    );
  });

  it('falls back to "profile" for non-admin users with legacy section IDs', () => {
    // content-organisation is in the content group, not visible to non-admins
    expect(getValidSection('taxonomy', false)).toBe('profile');
    expect(getValidSection('tags', false)).toBe('profile');
    expect(getValidSection('layers', false)).toBe('profile');
  });
});
