/**
 * SearchPromptCards Component Tests — §1.20 Browse Cards (S197)
 *
 * Covers:
 *   - Per-card classification matrix (AC-2a..AC-2m, spec §11 tests 1–10)
 *   - Handler branching by `kind` (tests 4, 5, 6, 7)
 *   - Language-alignment snapshot (test 8)
 *   - Whitelist key guard (test 9 — runtime belt-and-braces on top of the
 *     compile-time Pick-based `AllowedFilterPreset` in
 *     `components/browse/search-prompt-cards.tsx`)
 *   - Year-dependent card (test 10 — F-3 `date_from`)
 *   - All-persona-sets coverage (test 21)
 *   - Accessibility (tabindex, aria-label, role="group" live region)
 *
 * Integration tests (round-trip, outside-click dismiss) and E2E coverage
 * live in their dedicated files per spec §11.3–§11.4.
 */
import {
  describe,
  it,
  expect,
  expectTypeOf,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPromptCards } from '@/components/browse/search-prompt-cards';
import type {
  AllowedFilterPreset,
  PromptCard,
} from '@/components/browse/search-prompt-cards';
import type { BrowseFilters } from '@/types/content';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// Mock search-history so we can assert addRecentSearch is only called for
// SEARCH cards (AC-11).
vi.mock('@/lib/search-history', () => ({
  addRecentSearch: vi.fn(),
}));

// Mock the Supabase client used by useTopDomains. Default: empty domain
// counts (chip composite falls back to taxonomy names).
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: vi.fn(async () => ({
      data: { domain: {}, content_type: {}, platform: {} },
      error: null,
    })),
  }),
}));

// Mock the taxonomy context — the chipComposite card queries it for
// fallback names when the RPC returns nothing.
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: () => [
      'facilities_management',
      'compliance',
      'social_value',
    ],
    formatDomainName: (name: string) =>
      name
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' '),
  }),
}));

import { addRecentSearch } from '@/lib/search-history';

const { Wrapper } = createQueryWrapper();

describe('SearchPromptCards', () => {
  const mockOnSelectQuery = vi.fn();
  const mockOnApplyFilter = vi.fn();
  const mockOnOpenFilterPanel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Pin the year so F-3 `date_from` is deterministic (spec §5.5 / test
    // 10). `useFakeTimers({ toFake: ['Date'] })` pins the clock WITHOUT
    // trapping setTimeout/setInterval — userEvent needs real timers to
    // drain click/keyboard events, so the `advanceTimers` workaround
    // is not required.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderCards(props: {
    primaryFocus: Parameters<typeof SearchPromptCards>[0]['primaryFocus'];
    role: Parameters<typeof SearchPromptCards>[0]['role'];
  }) {
    return render(
      <SearchPromptCards
        primaryFocus={props.primaryFocus}
        role={props.role}
        onSelectQuery={mockOnSelectQuery}
        onApplyFilter={mockOnApplyFilter}
        onOpenFilterPanel={mockOnOpenFilterPanel}
      />,
      { wrapper: Wrapper },
    );
  }

  // ---------------------------------------------------------------------
  // Test 1 (L-B) — `expectTypeOf` AC-1 type gate
  //
  // The build-time gate is `as const satisfies ReadonlyArray<PromptCard>`
  // on each persona array (see `components/browse/search-prompt-cards.tsx`
  // §"Per-persona card data"). These assertions make the gate explicit
  // at the test level so a regression that loosens the discriminator,
  // widens `AllowedFilterPreset`, or accepts an `exampleQuery` on a
  // FILTER card breaks the test compile (and thus CI) — not just the
  // implicit production build.
  // ---------------------------------------------------------------------
  describe('AC-1 type gate (test 1, L-B)', () => {
    it('AllowedFilterPreset only accepts the whitelisted Pick-keys', () => {
      // Compile-time assertion: the published type IS a Pick of
      // BrowseFilters over the seven whitelisted keys (spec §4.4).
      // This cross-checks the export against the spec's enumeration.
      expectTypeOf<AllowedFilterPreset>().toEqualTypeOf<
        Pick<
          BrowseFilters,
          | 'domain'
          | 'content_type'
          | 'include_qa'
          | 'source'
          | 'date_from'
          | 'freshness'
          | 'layer'
        >
      >();
    });

    it('FilterPromptCard rejects exampleQuery; SearchPromptCard rejects filterPreset', () => {
      // A `filter`-kind card with an exampleQuery is a compile error.
      const _filterWithQuery: PromptCard = {
        id: 'x',
        kind: 'filter',
        title: 't',
        description: 'd',
        filterPreset: { content_type: ['policy'] },
        // @ts-expect-error — kind: 'filter' must not carry exampleQuery
        exampleQuery: 'should not compile',
      };
      void _filterWithQuery;

      // A `search`-kind card with a filterPreset is a compile error.
      const _searchWithPreset: PromptCard = {
        id: 'y',
        kind: 'search',
        title: 't',
        description: 'd',
        exampleQuery: 'q',
        // @ts-expect-error — kind: 'search' must not carry filterPreset
        filterPreset: { content_type: ['policy'] },
      };
      void _searchWithPreset;

      // A `filter`-kind card MISSING filterPreset is a compile error
      // because the discriminated union narrows to FilterPromptCard
      // when kind === 'filter', and FilterPromptCard requires
      // `filterPreset`. The @ts-expect-error attaches to the missing
      // property location — the assertion is the only place where the
      // type checker has a chance to flag the gap.
      // @ts-expect-error — kind: 'filter' requires filterPreset
      const _filterNoPreset: PromptCard = {
        id: 'z',
        kind: 'filter',
        title: 't',
        description: 'd',
      };
      void _filterNoPreset;
    });

    it('AllowedFilterPreset rejects keys outside the whitelist', () => {
      // Disallowed key `keywords` (a real BrowseFilters key, but NOT
      // in the whitelist) triggers the type-gate.
      const _withDisallowed: AllowedFilterPreset = {
        // @ts-expect-error — `keywords` is not part of AllowedFilterPreset
        keywords: ['x'],
      };
      void _withDisallowed;
    });
  });

  // ---------------------------------------------------------------------
  // Test 2 / 21 — persona-branch + all-persona-set coverage
  // ---------------------------------------------------------------------
  describe('persona branching (test 2 / 21)', () => {
    it('bid_writing set: 3 cards (0 chipComposite + 2 filter + 1 search)', () => {
      renderCards({ primaryFocus: 'bid_writing', role: 'editor' });
      expect(screen.getByText('Past bid responses')).toBeInTheDocument();
      expect(screen.getByText('Q&A library')).toBeInTheDocument();
      expect(screen.getByText('Case studies and evidence')).toBeInTheDocument();
      // No chipComposite in this set.
      expect(
        screen.queryByTestId('prompt-card-chip-composite'),
      ).not.toBeInTheDocument();
    });

    it('account_management set: 3 cards (0 chipComposite + 1 filter + 2 search)', () => {
      renderCards({ primaryFocus: 'account_management', role: 'editor' });
      expect(screen.getByText('Account context')).toBeInTheDocument();
      expect(screen.getByText('Win themes and proposals')).toBeInTheDocument();
      expect(screen.getByText('Sector intelligence')).toBeInTheDocument();
    });

    it('marketing set: 3 cards (0 chipComposite + 2 filter + 1 search)', () => {
      renderCards({ primaryFocus: 'marketing', role: 'editor' });
      expect(screen.getByText('Case studies')).toBeInTheDocument();
      expect(screen.getByText('Sector narratives')).toBeInTheDocument();
      expect(screen.getByText('Company evidence')).toBeInTheDocument();
    });

    it('fallback set: 4 cards (1 chipComposite + 3 filter + 0 search)', () => {
      renderCards({ primaryFocus: null, role: 'editor' });
      expect(screen.getByText('Browse by domain')).toBeInTheDocument();
      expect(
        screen.getByText('Find policies and standards'),
      ).toBeInTheDocument();
      expect(screen.getByText('Recent case studies')).toBeInTheDocument();
      expect(screen.getByText('Q&A library')).toBeInTheDocument();
      expect(
        screen.getByTestId('prompt-card-chip-composite'),
      ).toBeInTheDocument();
    });

    it('viewer role always gets fallback set regardless of primaryFocus', () => {
      renderCards({ primaryFocus: 'bid_writing', role: 'viewer' });
      expect(screen.getByText('Browse by domain')).toBeInTheDocument();
      expect(screen.queryByText('Past bid responses')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------
  // Test 4 — FILTER card click → onApplyFilter with correct preset
  // Test 11 / AC-11 — addRecentSearch NEVER called for FILTER cards
  // ---------------------------------------------------------------------
  describe('filter cards (test 4, AC-2b/c/d/f/g/j/k/m, AC-11)', () => {
    it('AC-2b F-2 Find policies and standards → { content_type: ["policy"] }', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: null, role: 'editor' });
      await user.click(screen.getByTestId('fallback-policies'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['policy'],
      });
      expect(mockOnSelectQuery).not.toHaveBeenCalled();
      expect(addRecentSearch).not.toHaveBeenCalled();
    });

    it('AC-2c F-3 Recent case studies → { content_type: [case_study], date_from: YYYY-01-01 }', async () => {
      // System time pinned to 2026-06-15 in beforeEach.
      const user = userEvent.setup();
      renderCards({ primaryFocus: null, role: 'editor' });
      await user.click(screen.getByTestId('fallback-recent-case-studies'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['case_study'],
        date_from: '2026-01-01',
      });
    });

    it('AC-2d F-4 Q&A library → { content_type: [q_a_pair], include_qa: true }', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: null, role: 'editor' });
      await user.click(screen.getByTestId('fallback-qa-library'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['q_a_pair'],
        include_qa: true,
      });
    });

    it('AC-2f B-2 Q&A library (bid_writing) → same preset as F-4', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'bid_writing', role: 'editor' });
      await user.click(screen.getByTestId('bid-writing-qa-library'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['q_a_pair'],
        include_qa: true,
      });
    });

    it('AC-2g B-3 Case studies and evidence → { content_type: [case_study] }', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'bid_writing', role: 'editor' });
      await user.click(screen.getByTestId('bid-writing-case-studies'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['case_study'],
      });
    });

    it('AC-2j A-3 Sector intelligence → { source: "intelligence_pipeline" }', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'account_management', role: 'editor' });
      await user.click(screen.getByTestId('account-sector-intelligence'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        source: 'intelligence_pipeline',
      });
    });

    it('AC-2k M-1 Case studies (marketing) → { content_type: [case_study] }', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'marketing', role: 'editor' });
      await user.click(screen.getByTestId('marketing-case-studies'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['case_study'],
      });
    });

    it('AC-2m M-3 Company evidence → { content_type: [certification, policy] }', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'marketing', role: 'editor' });
      await user.click(screen.getByTestId('marketing-company-evidence'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['certification', 'policy'],
      });
    });
  });

  // ---------------------------------------------------------------------
  // Test 5 — SEARCH card click → onSelectQuery + addRecentSearch
  // ---------------------------------------------------------------------
  describe('search cards (test 5, AC-2e/h/i/l, AC-6)', () => {
    it('AC-2e B-1 Past bid responses → onSelectQuery("social value policy responses")', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'bid_writing', role: 'editor' });
      await user.click(screen.getByTestId('bid-writing-past-bids'));
      expect(mockOnSelectQuery).toHaveBeenCalledWith(
        'social value policy responses',
      );
      expect(addRecentSearch).toHaveBeenCalledWith(
        'social value policy responses',
      );
      expect(mockOnApplyFilter).not.toHaveBeenCalled();
    });

    it('AC-2h A-1 Account context → onSelectQuery("contract renewal terms")', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'account_management', role: 'editor' });
      await user.click(screen.getByTestId('account-context'));
      expect(mockOnSelectQuery).toHaveBeenCalledWith('contract renewal terms');
      expect(addRecentSearch).toHaveBeenCalledWith('contract renewal terms');
    });

    it('AC-2i A-2 Win themes and proposals → onSelectQuery("competitive differentiators")', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'account_management', role: 'editor' });
      await user.click(screen.getByTestId('account-win-themes'));
      expect(mockOnSelectQuery).toHaveBeenCalledWith(
        'competitive differentiators',
      );
    });

    it('AC-2l M-2 Sector narratives → onSelectQuery (branding exception retained)', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'marketing', role: 'editor' });
      await user.click(screen.getByTestId('marketing-sector-narratives'));
      expect(mockOnSelectQuery).toHaveBeenCalledWith(
        'market trends education sector',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Test 6 / 7 — ChipComposite: chip click + more button
  // ---------------------------------------------------------------------
  describe('chipComposite card (tests 6, 7, AC-2a)', () => {
    it('AC-2a renders chips + More domains… button with accessible name', () => {
      renderCards({ primaryFocus: null, role: 'editor' });
      const card = screen.getByTestId('prompt-card-chip-composite');
      const heading = within(card).getByText('Browse by domain');
      expect(heading).toBeInTheDocument();
      // role="group" — accessible name is derived via `aria-labelledby`
      // pointing at the card title (`Browse by domain`). `aria-label`
      // is also present as a sibling descriptor but does not take
      // precedence. Assert the group exists and is a live region.
      const group = within(card).getByRole('group', {
        name: /browse by domain/i,
      });
      expect(group).toHaveAttribute('aria-live', 'polite');
      expect(group).toHaveAttribute('aria-label', 'Domain filter chips');
      // More-button.
      expect(
        within(card).getByRole('button', {
          name: /open filter panel to choose a different domain/i,
        }),
      ).toBeInTheDocument();
    });

    it('test 6: chip click → onApplyFilter({ domain: [slug] })', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: null, role: 'editor' });
      const card = screen.getByTestId('prompt-card-chip-composite');
      // With empty RPC response, chipComposite falls back to taxonomy
      // names — first is "facilities_management" from the mock.
      const firstChip = within(card).getByRole('button', {
        name: /filter to facilities management/i,
      });
      await user.click(firstChip);
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        domain: ['facilities_management'],
      });
      expect(mockOnSelectQuery).not.toHaveBeenCalled();
      expect(addRecentSearch).not.toHaveBeenCalled();
    });

    it('test 7: More button click → onOpenFilterPanel("domain")', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: null, role: 'editor' });
      const card = screen.getByTestId('prompt-card-chip-composite');
      const moreBtn = within(card).getByRole('button', {
        name: /open filter panel to choose a different domain/i,
      });
      await user.click(moreBtn);
      expect(mockOnOpenFilterPanel).toHaveBeenCalledWith('domain');
      expect(mockOnApplyFilter).not.toHaveBeenCalled();
      expect(mockOnSelectQuery).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Test 8 — Language alignment (AC-4)
  // ---------------------------------------------------------------------
  describe('language alignment (test 8, AC-4)', () => {
    it('no card title contains "sector" except branded product terms', () => {
      const allTitles: string[] = [];
      for (const focus of [
        null,
        'bid_writing',
        'account_management',
        'marketing',
      ] as const) {
        const { unmount } = renderCards({ primaryFocus: focus, role: 'admin' });
        // Collect every h-like text node — headings are rendered as <p class="...font-medium">
        screen.getAllByText(/.+/).forEach((node) => {
          if (node.tagName === 'P' && node.className.includes('font-medium')) {
            allTitles.push(node.textContent ?? '');
          }
        });
        unmount();
      }
      const offendingTitles = allTitles.filter(
        (t) =>
          /\bsector\b/i.test(t) &&
          t !== 'Sector intelligence' &&
          t !== 'Sector narratives',
      );
      expect(offendingTitles).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // Test 9 — Whitelist runtime check (AC-1)
  //
  // The compile-time `AllowedFilterPreset` on `FilterPromptCard.filterPreset`
  // is the primary enforcement; this runtime iterator is belt-and-braces.
  // ---------------------------------------------------------------------
  describe('filterPreset whitelist (test 9)', () => {
    it('every FILTER card preset uses only whitelisted keys', async () => {
      const ALLOWED = new Set([
        'domain',
        'content_type',
        'include_qa',
        'source',
        'date_from',
        'freshness',
        'layer',
      ]);
      const user = userEvent.setup();
      // Render every persona set and click every filter card to capture
      // the preset payload; we iterate testids rather than re-exporting
      // the card arrays.
      const allFilterTestIds = [
        { focus: null, id: 'fallback-policies' },
        { focus: null, id: 'fallback-recent-case-studies' },
        { focus: null, id: 'fallback-qa-library' },
        { focus: 'bid_writing', id: 'bid-writing-qa-library' },
        { focus: 'bid_writing', id: 'bid-writing-case-studies' },
        { focus: 'account_management', id: 'account-sector-intelligence' },
        { focus: 'marketing', id: 'marketing-case-studies' },
        { focus: 'marketing', id: 'marketing-company-evidence' },
      ] as const;

      for (const { focus, id } of allFilterTestIds) {
        vi.clearAllMocks();
        const { unmount } = renderCards({ primaryFocus: focus, role: 'admin' });
        await user.click(screen.getByTestId(id));
        expect(mockOnApplyFilter).toHaveBeenCalledTimes(1);
        const preset = mockOnApplyFilter.mock.calls[0][0] as Record<
          string,
          unknown
        >;
        for (const key of Object.keys(preset)) {
          expect(ALLOWED.has(key)).toBe(true);
        }
        unmount();
      }
    });
  });

  // ---------------------------------------------------------------------
  // Test 10 — Year-dependent F-3 card (AC-2c)
  // ---------------------------------------------------------------------
  describe('year-dependent card (test 10)', () => {
    it('F-3 `date_from` uses currentYear-01-01 via pinned clock', async () => {
      vi.setSystemTime(new Date('2030-03-14T09:00:00Z'));
      const user = userEvent.setup();
      renderCards({ primaryFocus: null, role: 'editor' });
      await user.click(screen.getByTestId('fallback-recent-case-studies'));
      expect(mockOnApplyFilter).toHaveBeenCalledWith(
        expect.objectContaining({ date_from: '2030-01-01' }),
      );
    });
  });

  // ---------------------------------------------------------------------
  // Accessibility
  // ---------------------------------------------------------------------
  describe('accessibility', () => {
    it('every non-chipComposite card is keyboard-focusable', () => {
      renderCards({ primaryFocus: 'bid_writing', role: 'editor' });
      const cards = screen.getAllByRole('button');
      // Filter out the chipComposite's internal buttons (chips + more)
      // — those have their own accessibility assertions in the chip tests.
      const searchAndFilterCards = cards.filter((c) =>
        c.getAttribute('data-testid')?.startsWith('bid-writing-'),
      );
      expect(searchAndFilterCards.length).toBe(3);
      searchAndFilterCards.forEach((c) => {
        expect(c).toHaveAttribute('tabindex', '0');
      });
    });

    it('SEARCH card aria-label combines title + example query', () => {
      renderCards({ primaryFocus: 'bid_writing', role: 'admin' });
      expect(screen.getByTestId('bid-writing-past-bids')).toHaveAttribute(
        'aria-label',
        'Past bid responses: social value policy responses',
      );
    });

    it('FILTER card aria-label equals title (no query)', () => {
      renderCards({ primaryFocus: 'bid_writing', role: 'admin' });
      expect(screen.getByTestId('bid-writing-qa-library')).toHaveAttribute(
        'aria-label',
        'Q&A library',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Keyboard interaction (Enter / Space) on FILTER + SEARCH cards
  // ---------------------------------------------------------------------
  describe('keyboard interaction', () => {
    it('SEARCH card Enter triggers onSelectQuery', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: 'bid_writing', role: 'editor' });
      const card = screen.getByTestId('bid-writing-past-bids') as HTMLElement;
      card.focus();
      await user.keyboard('{Enter}');
      expect(mockOnSelectQuery).toHaveBeenCalledWith(
        'social value policy responses',
      );
    });

    it('FILTER card Space triggers onApplyFilter', async () => {
      const user = userEvent.setup();
      renderCards({ primaryFocus: null, role: 'editor' });
      const card = screen.getByTestId('fallback-policies') as HTMLElement;
      card.focus();
      await user.keyboard(' ');
      expect(mockOnApplyFilter).toHaveBeenCalledWith({
        content_type: ['policy'],
      });
    });
  });
});
