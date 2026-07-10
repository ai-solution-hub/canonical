/**
 * Shared selectors for common UI components used across E2E tests.
 *
 * Prefer data-testid attributes where available, falling back to
 * accessible selectors (aria-label, role) and structural selectors.
 *
 * Navigation structure is derived from components/site-header.tsx.
 */
export const selectors = {
  /** Site header and main navigation */
  nav: {
    header: 'header',
    mainNav: 'nav[aria-label="Main navigation"]',
    mobileNav: 'nav[aria-label="Mobile navigation"]',
    homeLink: 'a:has-text("Canonical")',
    browseLink: 'a[href="/browse"]',
    libraryLink: 'a[href="/library"]',
    coverageLink: 'a[href="/coverage"]',
    procurementLink: 'a[href="/procurement"]',
    reviewLink: 'a[href="/review"]',
    settingsButton: 'button[aria-label="Settings"]',
    searchButton: 'button[aria-label="Search"]',
    mobileMenuButton: 'button[aria-label="Open navigation menu"]',
    aiAssistantButton:
      'button[aria-label="Open AI assistant"], button[aria-label="Close AI assistant"]',
  },

  /** Search components */
  search: {
    heroSearchBar:
      '[data-testid="hero-search"], input[placeholder*="Search" i]',
    compactSearchBar:
      '[data-testid="compact-search"], header input[placeholder*="Search" i]',
    searchResults: '[data-testid="search-results"]',
    searchResultItem: '[data-testid="search-result-item"]',
  },

  /** Browse page */
  browse: {
    contentGrid: '[data-testid="content-grid"]',
    contentList: '[data-testid="content-list"]',
    viewToggle: '[data-testid="view-toggle"]',
    filterBar: '[data-testid="filter-bar"]',
    domainFilter: '[data-testid="domain-filter"]',
    contentTypeFilter: '[data-testid="content-type-filter"]',
    pagination: '[data-testid="pagination"]',
    contentCard: '[data-testid="content-card"]',
  },

  /** Item detail page */
  item: {
    title: '[data-testid="item-title"], h1',
    domainBadge: '[data-testid="domain-badge"]',
    contentTypeBadge: '[data-testid="content-type-badge"]',
    freshnessBadge: '[data-testid="freshness-badge"]',
    prioritySelector: '[data-testid="priority-selector"]',
    aiSummary: '[data-testid="ai-summary"]',
    relatedItems: '[data-testid="related-items"]',
    readerContent: '[data-testid="reader-content"]',
  },

  /** Procurement pages */
  procurement: {
    // bidList/procurementName/procurementStatus (formerly [data-testid="bid-list"
    // /"bid-name"/"bid-status"]) removed — reconciled against ground truth for
    // {61.12}: no producer for these testids exists anywhere in components/app
    // (this selectors.ts file has zero importers, so they were orphaned dead
    // strings, not a live lockstep pair).
    procurementCard: '[data-testid^="procurement-card-"]',
    newProcurementButton: 'button:has-text("New Procurement")',
    questionsTab: '[data-testid="questions-tab"], button:has-text("Questions")',
    responsesTab: '[data-testid="responses-tab"], button:has-text("Responses")',
    documentsTab: '[data-testid="documents-tab"], button:has-text("Documents")',
    overviewTab: '[data-testid="overview-tab"], button:has-text("Overview")',
    exportButton: 'button:has-text("Export")',
    exportDocx:
      'button:has-text("Export as Word"), [data-testid="export-docx"]',
    exportXlsx:
      'button:has-text("Export as Excel"), [data-testid="export-xlsx"]',
  },

  /** Q&A Library */
  library: {
    qaList: '[data-testid="qa-list"]',
    qaItem: '[data-testid="qa-item"]',
    searchInput:
      '[data-testid="library-search"], input[placeholder*="Search" i]',
    domainFilter: '[data-testid="library-domain-filter"]',
  },

  /** Review page */
  review: {
    reviewQueue: '[data-testid="review-queue"]',
    reviewCard: '[data-testid="review-card"]',
    approveButton: 'button:has-text("Approve")',
    rejectButton: 'button:has-text("Reject")',
    skipButton: 'button:has-text("Skip")',
    reviewStats: '[data-testid="review-stats"]',
  },

  /** Settings page */
  settings: {
    profileSection: '[data-testid="profile-section"]',
    connectionsSection: '[data-testid="connections-section"]',
    taxonomySection: '[data-testid="taxonomy-section"]',
    tagsSection: '[data-testid="tags-section"]',
    teamSection: '[data-testid="team-section"]',
    governanceSection: '[data-testid="governance-section"]',
    activitySection: '[data-testid="activity-section"]',
  },

  /** Theme/appearance settings (site header dialog) */
  theme: {
    settingsButton:
      '[data-testid="theme-settings"], button[aria-label*="theme" i]',
    darkModeToggle: '[data-testid="dark-mode"]',
    lightModeToggle: '[data-testid="light-mode"]',
    systemModeToggle: '[data-testid="system-mode"]',
    dyslexiaFriendlyToggle: '[data-testid="dyslexia-friendly"]',
    highContrastToggle: '[data-testid="high-contrast"]',
    largeTextToggle: '[data-testid="large-text"]',
  },

  /** Common UI patterns */
  common: {
    toast: '[data-sonner-toast]',
    dialog: '[role="dialog"]',
    dialogClose: '[role="dialog"] button[aria-label="Close"]',
    loadingSpinner: '[data-testid="loading"], [aria-busy="true"]',
    emptyState: '[data-testid="empty-state"]',
    errorMessage: '[data-testid="error-message"], [role="alert"]',
  },
} as const;
