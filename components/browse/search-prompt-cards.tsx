'use client';

import { useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { PrimaryFocus } from '@/lib/user-focus-constants';
import { addRecentSearch } from '@/lib/search-history';
import type { BrowseFilters } from '@/types/content';
import { PromptCardChipComposite } from '@/components/browse/prompt-card-chip-composite';

// ---------------------------------------------------------------------------
// Prompt card data model — discriminated union (spec §1.20 §4.2)
// ---------------------------------------------------------------------------

/**
 * Whitelisted preset keys (spec §4.4). The Pick-based `AllowedFilterPreset`
 * type IS the compile-time enforcement gate — not merely descriptive.
 * Any card attempting to use keys outside this list fails the type check
 * at declaration time (via `satisfies ReadonlyArray<PromptCard>` below).
 * Test 9 in `search-prompt-cards.test.tsx` is a belt-and-braces runtime
 * iteration over every card.
 */
type AllowedPresetKey =
  | 'domain'
  | 'content_type'
  | 'include_qa'
  | 'source'
  | 'date_from'
  | 'freshness'
  | 'layer';

export type AllowedFilterPreset = Pick<BrowseFilters, AllowedPresetKey>;

interface PromptCardBase {
  /** Unique identifier — stable across renames; used as React key + test selector. */
  id: string;
  /** Card heading text. */
  title: string;
  /** Card body text — short explanation. */
  description: string;
}

interface FilterPromptCard extends PromptCardBase {
  kind: 'filter';
  filterPreset: AllowedFilterPreset;
}

interface SearchPromptCard extends PromptCardBase {
  kind: 'search';
  exampleQuery: string;
}

interface ChipCompositeCard extends PromptCardBase {
  kind: 'chipComposite';
  panelTarget: 'domain';
  moreLabel: string;
}

export type PromptCard =
  | FilterPromptCard
  | SearchPromptCard
  | ChipCompositeCard;

// ---------------------------------------------------------------------------
// Per-persona card data (spec §5.1–§5.4)
// ---------------------------------------------------------------------------

const BID_WRITING_CARDS = [
  {
    id: 'bid-writing-past-bids',
    kind: 'search',
    title: 'Past bid responses',
    description: 'Find reusable answers from previous submissions',
    exampleQuery: 'social value policy responses',
  },
  {
    id: 'bid-writing-qa-library',
    kind: 'filter',
    title: 'Q&A library',
    description: 'Browse all reusable Q&A pairs',
    filterPreset: { content_type: ['q_a_pair'], include_qa: true },
  },
  {
    id: 'bid-writing-case-studies',
    kind: 'filter',
    title: 'Case studies and evidence',
    description: 'Locate project outcomes and client success stories',
    filterPreset: { content_type: ['case_study'] },
  },
] as const satisfies ReadonlyArray<PromptCard>;

const ACCOUNT_MANAGEMENT_CARDS = [
  {
    id: 'account-context',
    kind: 'search',
    title: 'Account context',
    description: 'Find background information on customers and contracts',
    exampleQuery: 'contract renewal terms',
  },
  {
    id: 'account-win-themes',
    kind: 'search',
    title: 'Win themes and proposals',
    description: 'Search for winning themes from previous bids',
    exampleQuery: 'competitive differentiators',
  },
  {
    id: 'account-sector-intelligence',
    kind: 'filter',
    title: 'Sector intelligence',
    description: 'Browse industry trends and regulatory updates',
    filterPreset: { source: 'intelligence_pipeline' },
  },
] as const satisfies ReadonlyArray<PromptCard>;

const MARKETING_CARDS = [
  {
    id: 'marketing-case-studies',
    kind: 'filter',
    title: 'Case studies',
    description: 'Find project outcomes suitable for marketing collateral',
    filterPreset: { content_type: ['case_study'] },
  },
  {
    id: 'marketing-sector-narratives',
    kind: 'search',
    title: 'Sector narratives',
    description: 'Discover industry context for thought leadership content',
    exampleQuery: 'market trends education sector',
  },
  {
    id: 'marketing-company-evidence',
    kind: 'filter',
    title: 'Company evidence',
    description: 'Locate certifications, accreditations, and policy summaries',
    filterPreset: { content_type: ['certification', 'policy'] },
  },
] as const satisfies ReadonlyArray<PromptCard>;

/**
 * Fallback set — cards are built inside `getCardsForPersona` because F-3
 * `Recent case studies` carries a year-dependent `date_from` that must be
 * computed at call time (spec §5.5 Option A).
 */
function buildFallbackCards(currentYear: number): ReadonlyArray<PromptCard> {
  const cards: ReadonlyArray<PromptCard> = [
    {
      id: 'fallback-browse-by-domain',
      kind: 'chipComposite',
      title: 'Browse by domain',
      description: 'Explore content for a specific area of your business',
      panelTarget: 'domain',
      moreLabel: 'More domains…',
    },
    {
      id: 'fallback-policies',
      kind: 'filter',
      title: 'Find policies and standards',
      description: 'Browse regulatory and compliance content',
      filterPreset: { content_type: ['policy'] },
    },
    {
      id: 'fallback-recent-case-studies',
      kind: 'filter',
      title: 'Recent case studies',
      description: 'Discover the latest project outcomes and evidence',
      filterPreset: {
        content_type: ['case_study'],
        date_from: `${currentYear}-01-01`,
      },
    },
    {
      id: 'fallback-qa-library',
      kind: 'filter',
      title: 'Q&A library',
      description: 'Browse all reusable Q&A pairs',
      filterPreset: { content_type: ['q_a_pair'], include_qa: true },
    },
  ];
  return cards;
}

function getCardsForPersona(
  primaryFocus: PrimaryFocus | null,
  role: string,
  currentYear: number,
): ReadonlyArray<PromptCard> {
  // Viewers always see the fallback set regardless of primary_focus
  if (role === 'viewer') return buildFallbackCards(currentYear);

  switch (primaryFocus) {
    case 'bid_writing':
      return BID_WRITING_CARDS;
    case 'account_management':
      return ACCOUNT_MANAGEMENT_CARDS;
    case 'marketing':
      return MARKETING_CARDS;
    default:
      return buildFallbackCards(currentYear);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SearchPromptCardsProps {
  primaryFocus: PrimaryFocus | null;
  role: 'admin' | 'editor' | 'viewer';
  /** For SEARCH cards — writes ?q=<query> and records to recent searches. */
  onSelectQuery: (query: string) => void;
  /** For FILTER / CHIP cards — applies a `BrowseFilters` partial. */
  onApplyFilter: (preset: Partial<BrowseFilters>) => void;
  /** For CHIP-COMPOSITE cards — opens filter panel at a named section. */
  onOpenFilterPanel: (target: 'domain') => void;
}

export function SearchPromptCards({
  primaryFocus,
  role,
  onSelectQuery,
  onApplyFilter,
  onOpenFilterPanel,
}: SearchPromptCardsProps) {
  // Year is stable for the session — cold-start cards don't need to
  // re-render across midnight (§5.5).
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const cards = useMemo(
    () => getCardsForPersona(primaryFocus, role, currentYear),
    [primaryFocus, role, currentYear],
  );

  const handleSearchCardClick = useCallback(
    (query: string) => {
      addRecentSearch(query);
      onSelectQuery(query);
    },
    [onSelectQuery],
  );

  const handleFilterCardClick = useCallback(
    (preset: Partial<BrowseFilters>) => {
      onApplyFilter(preset);
    },
    [onApplyFilter],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent, query: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        addRecentSearch(query);
        onSelectQuery(query);
      }
    },
    [onSelectQuery],
  );

  const handleFilterKeyDown = useCallback(
    (e: React.KeyboardEvent, preset: Partial<BrowseFilters>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onApplyFilter(preset);
      }
    },
    [onApplyFilter],
  );

  return (
    <div
      className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
      data-testid="search-prompt-cards"
    >
      {cards.map((card) => {
        switch (card.kind) {
          case 'chipComposite':
            return (
              <PromptCardChipComposite
                key={card.id}
                title={card.title}
                description={card.description}
                moreLabel={card.moreLabel}
                onApplyFilter={handleFilterCardClick}
                onOpenFilterPanel={onOpenFilterPanel}
              />
            );
          case 'search':
            return (
              <div
                key={card.id}
                data-testid={card.id}
                role="button"
                tabIndex={0}
                aria-label={`${card.title}: ${card.exampleQuery}`}
                onClick={() => handleSearchCardClick(card.exampleQuery)}
                onKeyDown={(e) => handleSearchKeyDown(e, card.exampleQuery)}
                className="cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="text-sm font-medium text-foreground">
                  {card.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.description}
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs font-mono text-primary">
                  <Search className="size-3 shrink-0" aria-hidden="true" />
                  {card.exampleQuery}
                </p>
              </div>
            );
          case 'filter':
            return (
              <div
                key={card.id}
                data-testid={card.id}
                role="button"
                tabIndex={0}
                aria-label={card.title}
                onClick={() => handleFilterCardClick(card.filterPreset)}
                onKeyDown={(e) => handleFilterKeyDown(e, card.filterPreset)}
                className="cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="text-sm font-medium text-foreground">
                  {card.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.description}
                </p>
              </div>
            );
          default: {
            // Exhaustiveness check — adding a new `kind` forces a
            // compile error here until the switch is updated.
            const _exhaustive: never = card;
            return _exhaustive;
          }
        }
      })}
    </div>
  );
}
