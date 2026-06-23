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
    /**
     * Folder-drop ({56.12}) ingest poll — correlates a dropped filename to its
     * freshly-ingested content_items row via `source_file`. Keyed on the
     * source_file so concurrent drops poll independently.
     */
    ingestPoll: (sourceFile: string) =>
      ['content-items', 'ingest-poll', sourceFile] as const,
  },

  // References (global, workspace-less reference layer — ID-75 / ID-111).
  // Distinct from `contentItems` (content_items-shaped); references never
  // promote into content_items. `list`/`search`/`detail` map to the
  // reference_list / reference_search / reference_get_verbatim RPCs.
  references: {
    all: ['references'] as const,
    list: (filters: Record<string, unknown>) =>
      ['references', 'list', filters] as const,
    detail: (id: string) => ['references', 'detail', id] as const,
    search: (query: string) => ['references', 'search', query] as const,
  },

  // Review
  review: {
    all: ['review'] as const,
    queue: (filters?: Record<string, unknown>) =>
      ['review', 'queue', filters] as const,
    stats: ['review', 'stats'] as const,
    history: (itemId: string) => ['review', 'history', itemId] as const,
    assignments: ['review', 'assignments'] as const,
    /**
     * Awaiting-publication queue (tab 6 of /review) — REST
     * GET /api/review/queue?publication_status=in_review.
     * Spec: docs/specs/review-page-tabs-refactor-spec.md §8 (g)/(h)
     * (Approve & publish + Return to draft mutations both invalidate this
     * key on success).
     */
    publicationReviewQueue: (filters?: Record<string, unknown>) =>
      ['review', 'queue', 'publication-review', filters ?? {}] as const,
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

  // Change Reports (formerly Digests — code rename T5, S248)
  changeReports: {
    all: ['change-reports'] as const,
    latest: ['change-reports', 'latest'] as const,
    list: (limit: number, offset: number) =>
      ['change-reports', 'list', { limit, offset }] as const,
    detail: (id: string) => ['change-reports', 'detail', id] as const,
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

  // Content-item version history (ID-59 {59.12} user-edit Diff-UI).
  // Distinct from `sourceDocuments.history` (re-ingest doc diffs, INV-17):
  // this covers the content_history list + per-revision detail used by the
  // compare-two-versions affordance.
  itemHistory: {
    all: (itemId: string) => ['item-history', itemId] as const,
    list: (itemId: string, limit: number) =>
      ['item-history', itemId, 'list', limit] as const,
    version: (itemId: string, versionId: string) =>
      ['item-history', itemId, 'version', versionId] as const,
  },

  // Q&A pair revision history (ID-59 {59.16} user-edit Diff-UI, Q&A leg).
  // Source = q_a_pair_history (INV-14); each row carries the full revision body
  // + edit_intent, so the compare-two-versions affordance derives both diff
  // blobs from the list (no per-version detail leg, mirroring the content
  // surface's separate detail route is unnecessary here).
  qaPairHistory: {
    all: (pairId: string) => ['qa-pair-history', pairId] as const,
    list: (pairId: string, limit: number) =>
      ['qa-pair-history', pairId, 'list', limit] as const,
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

  // Application types (ID-29.6 — DB-driven workspace type registry)
  applicationTypes: {
    all: ['application-types'] as const,
    list: ['application-types', 'list'] as const,
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
    questions: (procurementId: string) =>
      ['bids', 'questions', procurementId] as const,
    readiness: (procurementId: string) =>
      ['bids', 'readiness', procurementId] as const,
    responseByQuestion: (procurementId: string, questionId: string) =>
      ['bids', 'response-by-question', procurementId, questionId] as const,
  },

  // Background queue jobs — `processing_queue` polling (S224 §5.4.1).
  jobs: {
    all: ['jobs'] as const,
    status: (jobId: string) => ['jobs', 'status', jobId] as const,
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

  // Admin Near-Duplicate Merge Dashboard (§1.9)
  adminNearDup: {
    all: ['admin', 'near-dup-pairs'] as const,
    pairs: (threshold: number, domain?: string) =>
      ['admin', 'near-dup-pairs', threshold, domain ?? null] as const,
    pair: (pairId: string) => ['admin', 'near-dup-pair', pairId] as const,
  },

  // Admin Cross-Workspace Q&A Dedup Proposals (ID-120 {120.8} — TECH P-4)
  // Mirrors `adminNearDup`: a list/queue key (optional status filter) + a
  // per-proposal detail key. The queue key carries the curator's status
  // filter (pending / approved / rejected / all) so switching the filter
  // bar busts the cache cleanly.
  adminQaDedup: {
    all: ['admin', 'qa-dedup-proposals'] as const,
    queue: (filters?: Record<string, unknown>) =>
      ['admin', 'qa-dedup-proposals', 'queue', filters ?? {}] as const,
    proposal: (id: string) => ['admin', 'qa-dedup-proposal', id] as const,
  },

  // ---------------------------------------------------------------------------
  // Eval engine (ID-104) — cost aggregate + future refinement keys
  // ---------------------------------------------------------------------------
  // {104.15}: cost rollup over `ai_call_events` keyed by touchpoint_id (T17).
  // {104.16}: refinement keys appended after this block (parallel Subtask).
  eval: {
    all: ['eval'] as const,
    /** Aggregate cost over all `ai_call_events` rows (T17 / B-INV-17). */
    costAggregate: ['eval', 'cost-aggregate'] as const,
  },
} as const;
