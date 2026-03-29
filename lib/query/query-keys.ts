/**
 * Centralised query key factory for TanStack Query.
 *
 * Every cache key used in useQuery/useMutation should be defined here so
 * that invalidation is predictable and grep-friendly.
 */
export const queryKeys = {
  // Example structure — expand as hooks migrate to useQuery
  taxonomy: {
    all: ['taxonomy'] as const,
    domains: () => [...queryKeys.taxonomy.all, 'domains'] as const,
    subtopics: (domainId: string) =>
      [...queryKeys.taxonomy.all, 'subtopics', domainId] as const,
  },
  content: {
    all: ['content'] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.content.all, 'list', filters] as const,
    detail: (id: string) => [...queryKeys.content.all, 'detail', id] as const,
  },
} as const;
