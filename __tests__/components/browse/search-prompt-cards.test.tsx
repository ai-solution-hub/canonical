/**
 * SearchPromptCards Component Tests
 *
 * Verifies P1-10 persona-branched prompt cards:
 * - Persona branch logic (spec test matrix 6.1: #1-#5)
 * - Click/keyboard interaction (spec test matrix 6.5: #16, #20, #21)
 * - Accessibility (spec test matrix 6.6: #19, #22, #23)
 * - Recent search storage on card click (OQ-2 resolution)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPromptCards } from '@/components/browse/search-prompt-cards';

// Mock search-history to verify addRecentSearch calls without localStorage
vi.mock('@/lib/search-history', () => ({
  addRecentSearch: vi.fn(),
}));

import { addRecentSearch } from '@/lib/search-history';

describe('SearchPromptCards', () => {
  const mockOnSelectQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----- Persona branch logic (spec 6.1 #1-#5) -----

  describe('persona branching', () => {
    it('renders 3 bid-oriented cards for bid_writing focus', () => {
      render(
        <SearchPromptCards
          primaryFocus="bid_writing"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards).toHaveLength(3);
      expect(screen.getByText('Past bid responses')).toBeInTheDocument();
      expect(screen.getByText('Q&A library')).toBeInTheDocument();
      expect(screen.getByText('Case studies and evidence')).toBeInTheDocument();
    });

    it('renders 3 account-oriented cards for account_management focus', () => {
      render(
        <SearchPromptCards
          primaryFocus="account_management"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards).toHaveLength(3);
      expect(screen.getByText('Account context')).toBeInTheDocument();
      expect(screen.getByText('Win themes and proposals')).toBeInTheDocument();
      expect(screen.getByText('Sector intelligence')).toBeInTheDocument();
    });

    it('renders 3 marketing-oriented cards for marketing focus', () => {
      render(
        <SearchPromptCards
          primaryFocus="marketing"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards).toHaveLength(3);
      expect(screen.getByText('Case studies')).toBeInTheDocument();
      expect(screen.getByText('Sector narratives')).toBeInTheDocument();
      expect(screen.getByText('Company evidence')).toBeInTheDocument();
    });

    it('renders 4 fallback cards when primaryFocus is null', () => {
      render(
        <SearchPromptCards
          primaryFocus={null}
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards).toHaveLength(4);
      expect(screen.getByText('Browse by sector')).toBeInTheDocument();
      expect(screen.getByText('Find policies and standards')).toBeInTheDocument();
      expect(screen.getByText('Recent case studies')).toBeInTheDocument();
      expect(screen.getByText('Bid question library')).toBeInTheDocument();
    });

    it('renders fallback cards for viewer role regardless of primaryFocus', () => {
      render(
        <SearchPromptCards
          primaryFocus="bid_writing"
          role="viewer"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards).toHaveLength(4);
      expect(screen.getByText('Browse by sector')).toBeInTheDocument();
      expect(screen.getByText('Find policies and standards')).toBeInTheDocument();
      // Bid-specific cards should NOT be present
      expect(screen.queryByText('Past bid responses')).not.toBeInTheDocument();
    });
  });

  // ----- Example query visibility (OQ-3 resolution) -----

  describe('example query display', () => {
    it('always shows the example query on each card', () => {
      render(
        <SearchPromptCards
          primaryFocus="bid_writing"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      expect(
        screen.getByText('social value policy responses'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('health and safety certifications'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('case study local authority'),
      ).toBeInTheDocument();
    });
  });

  // ----- Click interaction (spec 6.5 #16) -----

  describe('click interaction', () => {
    it('calls onSelectQuery with the example query on click', async () => {
      const user = userEvent.setup();
      render(
        <SearchPromptCards
          primaryFocus="bid_writing"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const card = screen.getByText('Past bid responses').closest('[role="button"]')!;
      await user.click(card);

      expect(mockOnSelectQuery).toHaveBeenCalledWith(
        'social value policy responses',
      );
    });

    it('calls addRecentSearch with the example query on click', async () => {
      const user = userEvent.setup();
      render(
        <SearchPromptCards
          primaryFocus="bid_writing"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const card = screen.getByText('Q&A library').closest('[role="button"]')!;
      await user.click(card);

      expect(addRecentSearch).toHaveBeenCalledWith(
        'health and safety certifications',
      );
    });
  });

  // ----- Keyboard interaction (spec 6.6 #20, #21) -----

  describe('keyboard interaction', () => {
    it('activates card with Enter key', async () => {
      const user = userEvent.setup();
      render(
        <SearchPromptCards
          primaryFocus="account_management"
          role="admin"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const card = screen.getByText('Account context').closest('[role="button"]')!;
      card.focus();
      await user.keyboard('{Enter}');

      expect(mockOnSelectQuery).toHaveBeenCalledWith('contract renewal terms');
      expect(addRecentSearch).toHaveBeenCalledWith('contract renewal terms');
    });

    it('activates card with Space key', async () => {
      const user = userEvent.setup();
      render(
        <SearchPromptCards
          primaryFocus="marketing"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const card = screen.getByText('Case studies').closest('[role="button"]')!;
      card.focus();
      await user.keyboard(' ');

      expect(mockOnSelectQuery).toHaveBeenCalledWith(
        'measurable outcomes community services',
      );
      expect(addRecentSearch).toHaveBeenCalledWith(
        'measurable outcomes community services',
      );
    });
  });

  // ----- Accessibility (spec 6.6 #19, #22, #23) -----

  describe('accessibility', () => {
    it('all cards are keyboard-focusable via tabIndex', () => {
      render(
        <SearchPromptCards
          primaryFocus="bid_writing"
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      cards.forEach((card) => {
        expect(card).toHaveAttribute('tabindex', '0');
      });
    });

    it('each card has role="button"', () => {
      render(
        <SearchPromptCards
          primaryFocus={null}
          role="editor"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards.length).toBeGreaterThan(0);
    });

    it('each card has an aria-label combining title and example query', () => {
      render(
        <SearchPromptCards
          primaryFocus="bid_writing"
          role="admin"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      const cards = screen.getAllByRole('button');
      expect(cards[0]).toHaveAttribute(
        'aria-label',
        'Past bid responses: social value policy responses',
      );
      expect(cards[1]).toHaveAttribute(
        'aria-label',
        'Q&A library: health and safety certifications',
      );
      expect(cards[2]).toHaveAttribute(
        'aria-label',
        'Case studies and evidence: case study local authority',
      );
    });
  });

  // ----- Fallback card queries -----

  describe('fallback card queries', () => {
    it('displays correct example queries for fallback cards', () => {
      render(
        <SearchPromptCards
          primaryFocus={null}
          role="admin"
          onSelectQuery={mockOnSelectQuery}
        />,
      );

      expect(screen.getByText('facilities management')).toBeInTheDocument();
      expect(screen.getByText('health and safety policy')).toBeInTheDocument();
      expect(screen.getByText('case study 2025')).toBeInTheDocument();
      expect(screen.getByText('social value commitments')).toBeInTheDocument();
    });
  });
});
