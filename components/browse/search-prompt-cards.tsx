'use client';

import { useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { PrimaryFocus } from '@/lib/user-focus-constants';
import { addRecentSearch } from '@/lib/search-history';

// ---------------------------------------------------------------------------
// Prompt card data
// ---------------------------------------------------------------------------

interface PromptCard {
  title: string;
  description: string;
  exampleQuery: string;
}

const BID_WRITING_CARDS: readonly PromptCard[] = [
  {
    title: 'Past bid responses',
    description:
      'Find reusable answers from previous submissions',
    exampleQuery: 'social value policy responses',
  },
  {
    title: 'Q&A library',
    description:
      'Search your question-and-answer pairs for common bid questions',
    exampleQuery: 'health and safety certifications',
  },
  {
    title: 'Case studies and evidence',
    description:
      'Locate project outcomes and client success stories',
    exampleQuery: 'case study local authority',
  },
] as const;

const ACCOUNT_MANAGEMENT_CARDS: readonly PromptCard[] = [
  {
    title: 'Account context',
    description:
      'Find background information on customers and contracts',
    exampleQuery: 'contract renewal terms',
  },
  {
    title: 'Win themes and proposals',
    description:
      'Search for winning themes from previous bids',
    exampleQuery: 'competitive differentiators',
  },
  {
    title: 'Sector intelligence',
    description:
      'Browse industry trends and regulatory updates',
    exampleQuery: 'sector update facilities management',
  },
] as const;

const MARKETING_CARDS: readonly PromptCard[] = [
  {
    title: 'Case studies',
    description:
      'Find project outcomes suitable for marketing collateral',
    exampleQuery: 'measurable outcomes community services',
  },
  {
    title: 'Sector narratives',
    description:
      'Discover industry context for thought leadership content',
    exampleQuery: 'market trends education sector',
  },
  {
    title: 'Company evidence',
    description:
      'Locate certifications, accreditations, and policy summaries',
    exampleQuery: 'ISO 14001 environmental management',
  },
] as const;

const FALLBACK_CARDS: readonly PromptCard[] = [
  {
    title: 'Browse by sector',
    description: 'Explore content related to your industry',
    exampleQuery: 'facilities management',
  },
  {
    title: 'Find policies and standards',
    description:
      'Search for regulatory and compliance content',
    exampleQuery: 'health and safety policy',
  },
  {
    title: 'Recent case studies',
    description:
      'Discover the latest project outcomes and evidence',
    exampleQuery: 'case study 2025',
  },
  {
    title: 'Bid question library',
    description:
      'Search reusable Q&A pairs from past submissions',
    exampleQuery: 'social value commitments',
  },
] as const;

function getCardsForPersona(
  primaryFocus: PrimaryFocus | null,
  role: string,
): readonly PromptCard[] {
  // Viewers always see the fallback set regardless of primary_focus
  if (role === 'viewer') return FALLBACK_CARDS;

  switch (primaryFocus) {
    case 'bid_writing':
      return BID_WRITING_CARDS;
    case 'account_management':
      return ACCOUNT_MANAGEMENT_CARDS;
    case 'marketing':
      return MARKETING_CARDS;
    default:
      return FALLBACK_CARDS;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SearchPromptCardsProps {
  primaryFocus: PrimaryFocus | null;
  role: 'admin' | 'editor' | 'viewer';
  onSelectQuery: (query: string) => void;
}

export function SearchPromptCards({
  primaryFocus,
  role,
  onSelectQuery,
}: SearchPromptCardsProps) {
  const cards = useMemo(
    () => getCardsForPersona(primaryFocus, role),
    [primaryFocus, role],
  );

  const handleCardClick = useCallback(
    (query: string) => {
      addRecentSearch(query);
      onSelectQuery(query);
    },
    [onSelectQuery],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, query: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        addRecentSearch(query);
        onSelectQuery(query);
      }
    },
    [onSelectQuery],
  );

  return (
    <div
      className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
      data-testid="search-prompt-cards"
    >
      {cards.map((card) => (
        <div
          key={card.exampleQuery}
          role="button"
          tabIndex={0}
          aria-label={`${card.title}: ${card.exampleQuery}`}
          onClick={() => handleCardClick(card.exampleQuery)}
          onKeyDown={(e) => handleKeyDown(e, card.exampleQuery)}
          className="cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-sm font-medium text-foreground">{card.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {card.description}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs font-mono text-primary">
            <Search className="size-3 shrink-0" aria-hidden="true" />
            {card.exampleQuery}
          </p>
        </div>
      ))}
    </div>
  );
}
