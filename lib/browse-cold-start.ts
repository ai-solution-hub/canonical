/**
 * Browse cold-start gate — determines whether the persona-branched
 * prompt cards (P1-10 SearchPromptCards) should render.
 *
 * Cold-start = user has not yet refined the view and the KB has content
 * to search. All 5 conditions must be true. Extracted as a pure helper
 * to make the visibility contract unit-testable per spec §6.2.
 */

/** @public */
export interface BrowseColdStartInputs {
  searchQuery: string;
  activeFilterCount: number;
  showUnreadOnly: boolean;
  isLoading: boolean;
  totalCount: number | null;
}

export function shouldShowColdStartPrompts(
  inputs: BrowseColdStartInputs,
): boolean {
  return (
    !inputs.searchQuery &&
    inputs.activeFilterCount === 0 &&
    !inputs.showUnreadOnly &&
    !inputs.isLoading &&
    inputs.totalCount !== null &&
    inputs.totalCount > 0
  );
}
