/**
 * Default mock values for React context providers.
 *
 * Use these with real Context.Provider wrappers (preferred) or spread into
 * vi.mock() factories. Each factory returns a fresh object to avoid cross-test
 * contamination. Accepts partial overrides for per-test customisation.
 */
import { vi } from 'vitest';
import type {
  FeatureName,
  FeatureToggle,
  LayerDefinition,
} from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Taxonomy context
// ---------------------------------------------------------------------------

export interface MockTaxonomyContextValue {
  domains: Array<{
    id: string;
    name: string;
    display_order: number;
    colour: string | null;
    is_active: boolean;
  }>;
  subtopics: Array<{
    id: string;
    domain_id: string;
    name: string;
    display_order: number;
    is_active: boolean;
  }>;
  loading: boolean;
  error: string | null;
  getDomainNames: () => string[];
  getSubtopics: (domainName: string) => string[];
  getDomainColourKey: (domainName: string) => string;
  formatSubtopic: (subtopic: string) => string;
  formatDomainName: (domain: string) => string;
  refresh: () => void;
}

const DEFAULT_DOMAINS = [
  {
    id: 'dom-1',
    name: 'Corporate',
    display_order: 1,
    colour: 'corporate',
    is_active: true,
  },
  {
    id: 'dom-2',
    name: 'Technical',
    display_order: 2,
    colour: 'technical',
    is_active: true,
  },
  {
    id: 'dom-3',
    name: 'Commercial',
    display_order: 3,
    colour: 'commercial',
    is_active: true,
  },
];

const DEFAULT_SUBTOPICS = [
  {
    id: 'sub-1',
    domain_id: 'dom-1',
    name: 'Company History',
    display_order: 1,
    is_active: true,
  },
  {
    id: 'sub-2',
    domain_id: 'dom-2',
    name: 'Infrastructure',
    display_order: 1,
    is_active: true,
  },
  {
    id: 'sub-3',
    domain_id: 'dom-3',
    name: 'Pricing',
    display_order: 1,
    is_active: true,
  },
];

export function mockTaxonomyContext(
  overrides: Partial<MockTaxonomyContextValue> = {},
): MockTaxonomyContextValue {
  const domains = overrides.domains ?? DEFAULT_DOMAINS;
  const subtopics = overrides.subtopics ?? DEFAULT_SUBTOPICS;

  return {
    domains,
    subtopics,
    loading: false,
    error: null,
    getDomainNames: () => domains.map((d) => d.name),
    getSubtopics: (domainName: string) => {
      const domain = domains.find((d) => d.name === domainName);
      if (!domain) return [];
      return subtopics
        .filter((s) => s.domain_id === domain.id)
        .map((s) => s.name);
    },
    getDomainColourKey: (domainName: string) => {
      const domain = domains.find((d) => d.name === domainName);
      return domain?.colour ?? 'corporate';
    },
    formatSubtopic: (s: string) =>
      s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    formatDomainName: (d: string) =>
      d.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    refresh: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Read marks context
// ---------------------------------------------------------------------------

export interface MockReadMarksContextValue {
  readItemIds: Set<string>;
  readCount: number;
  unreadCount: number;
  totalCount: number;
  isLoaded: boolean;
  isRead: (itemId: string) => boolean;
  toggleRead: (itemId: string, source?: string) => Promise<void>;
  markRead: (itemId: string, source?: string) => Promise<void>;
  markUnread: (itemId: string) => Promise<void>;
  markBulkRead: (itemIds: string[], source?: string) => Promise<void>;
  loadReadMarks: () => void;
  checkReadStatus: (itemIds: string[]) => Promise<void>;
}

export function mockReadMarksContext(
  overrides: Partial<MockReadMarksContextValue> = {},
): MockReadMarksContextValue {
  const readItemIds = overrides.readItemIds ?? new Set<string>();

  return {
    readItemIds,
    readCount: overrides.readCount ?? 0,
    unreadCount: overrides.unreadCount ?? 0,
    totalCount: overrides.totalCount ?? 0,
    isLoaded: overrides.isLoaded ?? true,
    isRead: (itemId: string) => readItemIds.has(itemId),
    toggleRead: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn().mockResolvedValue(undefined),
    markUnread: vi.fn().mockResolvedValue(undefined),
    markBulkRead: vi.fn().mockResolvedValue(undefined),
    loadReadMarks: vi.fn(),
    checkReadStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Client features context
// ---------------------------------------------------------------------------

export interface MockClientFeaturesContextValue {
  features: Record<FeatureName, FeatureToggle>;
  isFeatureEnabled: (feature: FeatureName) => boolean;
  clientName: string;
}

const DEFAULT_FEATURES: Record<FeatureName, FeatureToggle> = {
  tag_management: { enabled: true, label: 'Tag Management', description: '' },
  coverage_dashboard: {
    enabled: false,
    label: 'Coverage Dashboard',
    description: '',
  },
  content_layers: { enabled: false, label: 'Content Layers', description: '' },
  draft_status: { enabled: true, label: 'Draft Status', description: '' },
  ai_integration: { enabled: true, label: 'AI Integration', description: '' },
  bid_management: {
    enabled: true,
    label: 'Procurement Management',
    description: '',
  },
};

export function mockClientFeaturesContext(
  overrides: Partial<MockClientFeaturesContextValue> = {},
): MockClientFeaturesContextValue {
  const features = overrides.features ?? DEFAULT_FEATURES;

  return {
    features,
    isFeatureEnabled: (feature: FeatureName) =>
      features[feature]?.enabled ?? false,
    clientName: overrides.clientName ?? 'Knowledge Hub',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Layer vocabulary context
// ---------------------------------------------------------------------------

export interface MockLayerVocabularyContextValue {
  layers: LayerDefinition[];
  loading: boolean;
  error: string | null;
  getLayerKeys: () => string[];
  getLayerLabel: (key: string) => string;
  getLayerDescription: (key: string) => string;
  refresh: () => void;
}

const DEFAULT_LAYERS: LayerDefinition[] = [
  {
    key: 'sales_brief',
    label: 'Sales Brief',
    description: 'Positioning and messaging for internal sales',
    order: 1,
  },
  {
    key: 'bid_detail',
    label: 'Procurement Detail',
    description: 'Factual content for tender responses',
    order: 2,
  },
  {
    key: 'company_reference',
    label: 'Company Reference',
    description: 'Controlled corporate documents',
    order: 3,
  },
  {
    key: 'research',
    label: 'Research',
    description: 'Background material and market intelligence',
    order: 4,
  },
];

export function mockLayerVocabularyContext(
  overrides: Partial<MockLayerVocabularyContextValue> = {},
): MockLayerVocabularyContextValue {
  const layers = overrides.layers ?? DEFAULT_LAYERS;

  return {
    layers,
    loading: false,
    error: null,
    getLayerKeys: () => layers.map((l) => l.key),
    getLayerLabel: (key: string) =>
      layers.find((l) => l.key === key)?.label ?? key,
    getLayerDescription: (key: string) =>
      layers.find((l) => l.key === key)?.description ?? '',
    refresh: vi.fn(),
    ...overrides,
  };
}
