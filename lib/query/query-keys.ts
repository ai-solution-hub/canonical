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
  // Search (lexical preview — distinct from contentItems.search which is semantic)
  search: {
    all: ['search'] as const,
    preview: (q: string) => ['search', 'preview', q] as const,
  },

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
    adminDomains: ['taxonomy', 'admin-domains'] as const,
    adminSubtopics: (domainId: string) =>
      ['taxonomy', 'subtopics', domainId] as const,
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

  // Browse cold-start (spec §1.20 Browse Cards)
  browse: {
    all: ['browse'] as const,
    topDomains: ['browse', 'top-domains'] as const,
  },

  // Source documents
  sourceDocuments: {
    all: ['source-documents'] as const,
    diff: (documentId: string) =>
      ['source-documents', 'diff', documentId] as const,
    history: (documentId: string) =>
      ['source-documents', 'history', documentId] as const,
    sourceFiles: ['source-documents', 'source-files'] as const,
  },

  // Workspaces
  workspaces: {
    all: ['workspaces'] as const,
    list: ['workspaces', 'list'] as const,
    detail: (id: string) => ['workspaces', 'detail', id] as const,
  },

  // Intelligence
  intelligence: {
    all: ['intelligence'] as const,
    profiles: {
      all: ['intelligence', 'profiles'] as const,
      list: ['intelligence', 'profiles', 'list'] as const,
      detail: (id: string) =>
        ['intelligence', 'profiles', 'detail', id] as const,
    },
    workspaces: {
      all: ['intelligence', 'workspaces'] as const,
      list: ['intelligence', 'workspaces', 'list'] as const,
      detail: (id: string) =>
        ['intelligence', 'workspaces', 'detail', id] as const,
    },
    sources: {
      all: (workspaceId: string) =>
        ['intelligence', 'sources', workspaceId] as const,
      list: (workspaceId: string) =>
        ['intelligence', 'sources', workspaceId, 'list'] as const,
      detail: (workspaceId: string, sourceId: string) =>
        ['intelligence', 'sources', workspaceId, 'detail', sourceId] as const,
      seedStarterPack: (workspaceId: string) =>
        ['intelligence', 'sources', workspaceId, 'seed-starter-pack'] as const,
    },
    articles: {
      all: (workspaceId: string) =>
        ['intelligence', 'articles', workspaceId] as const,
      list: (workspaceId: string, filters: Record<string, unknown>) =>
        ['intelligence', 'articles', workspaceId, 'list', filters] as const,
    },
    prompts: {
      all: (workspaceId: string) =>
        ['intelligence', 'prompts', workspaceId] as const,
      list: (workspaceId: string) =>
        ['intelligence', 'prompts', workspaceId, 'list'] as const,
    },
    flags: {
      all: (workspaceId: string) =>
        ['intelligence', 'flags', workspaceId] as const,
      list: (workspaceId: string, filters?: Record<string, unknown>) =>
        ['intelligence', 'flags', workspaceId, 'list', filters ?? {}] as const,
    },
    metrics: {
      summary: (workspaceId: string, period?: string) =>
        ['intelligence', 'metrics', workspaceId, period ?? '30d'] as const,
      trend: (workspaceId: string, granularity: string, period?: string) =>
        [
          'intelligence',
          'metrics',
          workspaceId,
          'trend',
          granularity,
          period ?? '90d',
        ] as const,
      promptPerformance: (workspaceId: string) =>
        ['intelligence', 'metrics', workspaceId, 'prompt-performance'] as const,
    },
    health: {
      workspace: (workspaceId: string) =>
        ['intelligence', 'health', workspaceId] as const,
    },
  },

  // Notifications
  notifications: {
    all: ['notifications'] as const,
    list: ['notifications', 'list'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    preferences: ['notifications', 'preferences'] as const,
  },

  // Organisation profile (app-wide, P1-15)
  organisationProfile: {
    all: ['organisation-profile'] as const,
    primary: ['organisation-profile', 'primary'] as const,
  },

  // Settings
  settings: {
    all: ['settings'] as const,
    profile: ['settings', 'profile'] as const,
    team: ['settings', 'team'] as const,
    governance: ['settings', 'governance'] as const,
  },

  // Layers (admin)
  layers: {
    all: ['layers'] as const,
    list: ['layers', 'list'] as const,
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

  // User
  user: {
    all: ['user'] as const,
    role: ['user', 'role'] as const,
    claudeConnected: ['user', 'claude-connected'] as const,
    primaryFocus: ['user', 'primary-focus'] as const,
  },

  // Citations
  citations: {
    all: ['citations'] as const,
    orphans: (sortedIdKey: string) =>
      ['citations', 'orphans', sortedIdKey] as const,
  },

  // Progress
  progress: {
    all: ['progress'] as const,
    stats: (readCount?: number) =>
      readCount !== undefined
        ? (['progress', 'stats', readCount] as const)
        : (['progress', 'stats'] as const),
  },

  // Q&A Provenance
  qaProvenance: {
    all: ['qa-provenance'] as const,
    workspaces: (itemId: string) =>
      ['qa-provenance', 'workspaces', itemId] as const,
    related: (itemId: string, sourceFile: string) =>
      ['qa-provenance', 'related', itemId, sourceFile] as const,
    layers: (itemId: string) => ['qa-provenance', 'layers', itemId] as const,
  },

  // Bids
  bids: {
    all: ['bids'] as const,
    list: ['bids', 'list'] as const,
    detail: (id: string) => ['bids', 'detail', id] as const,
    questions: (bidId: string) => ['bids', 'questions', bidId] as const,
    readiness: (bidId: string) => ['bids', 'readiness', bidId] as const,
    responseByQuestion: (bidId: string, questionId: string) =>
      ['bids', 'response-by-question', bidId, questionId] as const,
  },

  // Topic layers
  topicLayers: {
    all: ['topic-layers'] as const,
    content: (siblingIds: string[]) =>
      ['topic-layers', 'content', [...siblingIds].sort().join(',')] as const,
  },

  // File uploads
  fileUploads: {
    all: ['file-uploads'] as const,
  },

  // Display names (user UUID -> name resolution)
  displayNames: {
    all: ['display-names'] as const,
    batch: (idsKey: string) => ['display-names', 'batch', idsKey] as const,
  },

  // Provenance
  provenance: {
    item: (id: string) => ['provenance', 'item', id] as const,
  },

  // Taxonomy sync (drift-detection banner, P0-TX)
  taxonomySyncStatus: ['taxonomy-sync-status'] as const,

  // Admin monitoring (pipeline_runs dashboard tile, S152B WP4)
  admin: {
    all: ['admin'] as const,
    pipelineRunsRecent: ['admin', 'pipeline-runs', 'recent'] as const,
    provenance: {
      all: ['admin', 'provenance'] as const,
      pipelineRuns: (filters: { range: string; kinds?: readonly string[] }) =>
        [
          'admin',
          'provenance',
          'pipeline-runs',
          filters.range,
          (filters.kinds ?? []).slice().sort().join(','),
        ] as const,
    },
  },

  // Admin Cross-System Dedup Review (§1.7)
  adminDedup: {
    all: ['admin', 'content-dedup'] as const,
    queue: (filters?: Record<string, unknown>) =>
      ['admin', 'content-dedup', 'queue', filters ?? {}] as const,
    item: (id: string) => ['admin', 'content-dedup', 'item', id] as const,
  },
} as const;
