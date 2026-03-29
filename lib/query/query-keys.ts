/**
 * Centralised query key factory for TanStack Query.
 *
 * Every cache key used in useQuery/useMutation should be defined here so
 * that invalidation is predictable and grep-friendly.
 *
 * Convention: hierarchical keys enable prefix invalidation.
 * Invalidating `queryKeys.tags.all` also invalidates `tags.list`,
 * `tags.duplicates`, etc.
 */
export const queryKeys = {
  // Content items
  contentItems: {
    all: ['content-items'] as const,
    browse: (filters: Record<string, unknown>) =>
      ['content-items', 'browse', filters] as const,
    search: (query: string) => ['content-items', 'search', query] as const,
    library: (filters: Record<string, unknown>) =>
      ['content-items', 'library', filters] as const,
    detail: (id: string) => ['content-items', 'detail', id] as const,
  },

  // Review
  review: {
    all: ['review'] as const,
    queue: (filters?: Record<string, unknown>) =>
      ['review', 'queue', filters] as const,
    stats: ['review', 'stats'] as const,
    history: (itemId: string) => ['review', 'history', itemId] as const,
    assignments: ['review', 'assignments'] as const,
  },

  // Taxonomy
  taxonomy: {
    all: ['taxonomy'] as const,
    domains: ['taxonomy', 'domains'] as const,
    subtopics: ['taxonomy', 'subtopics'] as const,
  },

  // Tags
  tags: {
    all: ['tags'] as const,
    list: ['tags', 'list'] as const,
    duplicates: ['tags', 'duplicates'] as const,
    byDomain: ['tags', 'by-domain'] as const,
  },

  // Digests (Change Reports)
  digests: {
    all: ['digests'] as const,
    latest: ['digests', 'latest'] as const,
    list: (limit: number, offset: number) =>
      ['digests', 'list', { limit, offset }] as const,
    detail: (id: string) => ['digests', 'detail', id] as const,
  },

  // Entities
  entities: {
    all: ['entities'] as const,
    list: (filters?: Record<string, unknown>) =>
      ['entities', 'list', filters] as const,
    detail: (canonicalName: string) =>
      ['entities', 'detail', canonicalName] as const,
  },

  // Dashboard
  dashboard: {
    all: ['dashboard'] as const,
    summary: ['dashboard', 'summary'] as const,
    activity: ['dashboard', 'activity'] as const,
    compliance: ['dashboard', 'compliance'] as const,
    ownedHealth: ['dashboard', 'owned-health'] as const,
  },

  // Coverage
  coverage: {
    all: ['coverage'] as const,
    matrix: ['coverage', 'matrix'] as const,
    gaps: ['coverage', 'gaps'] as const,
    targets: ['coverage', 'targets'] as const,
  },

  // Read marks
  readMarks: {
    all: ['read-marks'] as const,
    counts: ['read-marks', 'counts'] as const,
    status: (itemIds: string[]) =>
      ['read-marks', 'status', itemIds.sort().join(',')] as const,
  },

  // Filters (browse panel data)
  filters: {
    counts: ['filters', 'counts'] as const,
    authors: ['filters', 'authors'] as const,
    keywords: ['filters', 'keywords'] as const,
    workspaces: ['filters', 'workspaces'] as const,
    userTags: ['filters', 'user-tags'] as const,
    entities: ['filters', 'entities'] as const,
  },

  // Source documents
  sourceDocuments: {
    all: ['source-documents'] as const,
    diff: (documentId: string) =>
      ['source-documents', 'diff', documentId] as const,
    history: (documentId: string) =>
      ['source-documents', 'history', documentId] as const,
  },

  // Workspaces
  workspaces: {
    all: ['workspaces'] as const,
    list: ['workspaces', 'list'] as const,
    detail: (id: string) => ['workspaces', 'detail', id] as const,
  },

  // Notifications
  notifications: {
    all: ['notifications'] as const,
    list: ['notifications', 'list'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
  },

  // Settings
  settings: {
    all: ['settings'] as const,
    profile: ['settings', 'profile'] as const,
    team: ['settings', 'team'] as const,
    governance: ['settings', 'governance'] as const,
  },

  // Quality flags
  qualityFlags: {
    all: ['quality-flags'] as const,
    flaggedIds: ['quality-flags', 'flagged-ids'] as const,
  },

  // Freshness
  freshness: {
    counts: ['freshness', 'counts'] as const,
  },
  tags: {
    all: ['tags'] as const,
    list: ['tags', 'list'] as const,
    duplicates: ['tags', 'duplicates'] as const,
    byDomain: ['tags', 'byDomain'] as const,
  },
} as const;
