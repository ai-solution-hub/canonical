'use client';

/**
 * useApplicationTypes — TanStack Query hook for DB-driven application types.
 *
 * ID-29.6 (Path c — TECH.md §4 Option C hybrid).
 *
 * The route GET /api/application-types returns snake_case rows from the DB
 * (`application_types` table). This hook's `select:` callback normalises
 * snake_case → camelCase and joins each row with a static client-side config
 * map (route, available, hasCustomCreation, features.*) and a Lucide icon
 * resolution map (defaultIcon string → LucideIcon component).
 *
 * Why the split:
 *   - DB-driven fields (label, labelPlural, description, defaultIcon,
 *     defaultColour) are admin-editable → live in `application_types` table.
 *   - Code-side fields (route, available, hasCustomCreation, features.*) are
 *     developer-editable feature flags that must land via PR review, not via
 *     an admin UI mutation → live here in the static CLIENT_CONFIG map.
 */

import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  FileSignature,
  Folder,
  Newspaper,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Wire shape — matches GET /api/application-types (snake_case DB pass-through)
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/application-types. Mirrors application_types Row
 *  from `supabase/types/database.types.ts` (selected columns only). */
interface ApplicationTypeRowWire {
  readonly key: string;
  readonly label: string;
  readonly label_plural: string | null;
  readonly description: string | null;
  readonly default_icon: string | null;
  readonly default_colour: string | null;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Normalised (camelCase) shape as seen by hook consumers.
 * The `select:` selector maps snake_case → camelCase before callers see it.
 * Internal — exported as part of `WorkspaceTypeConfig` via `extends`.
 */
interface ApplicationTypeRow {
  readonly key: string;
  readonly label: string;
  readonly labelPlural: string;
  readonly description: string;
  readonly defaultIcon: string;
  readonly defaultColour: string;
}

/** Fully resolved config, joining DB row + static client config + Lucide icon. */
export interface WorkspaceTypeConfig extends ApplicationTypeRow {
  /** Resolved LucideIcon looked up from defaultIcon via ICON_MAP. */
  readonly icon: LucideIcon;
  /** Next.js routing target — static client config per TECH.md §4 Option C. */
  readonly route: string | null;
  /** Whether the type is renderable today (false = "Coming soon"). */
  readonly available: boolean;
  /** Whether the type has a dedicated custom creation flow. */
  readonly hasCustomCreation: boolean;
  /** Feature flags — code-side, PR-reviewed, not admin-editable. */
  readonly features: {
    readonly hasStatus: boolean;
    readonly hasContentAssignment: boolean;
    readonly hasDomainMetadata: boolean;
  };
}

// ---------------------------------------------------------------------------
// Static client config (TECH.md §4 Option C)
// Keys must match `application_types.key` values exactly.
// ---------------------------------------------------------------------------

interface ClientConfig {
  readonly route: string | null;
  readonly available: boolean;
  readonly hasCustomCreation: boolean;
  readonly features: {
    readonly hasStatus: boolean;
    readonly hasContentAssignment: boolean;
    readonly hasDomainMetadata: boolean;
  };
}

/** Permissive defaults for keys not in the static map (unknown / future types). */
const PERMISSIVE_DEFAULT: ClientConfig = {
  route: null,
  available: false,
  hasCustomCreation: false,
  features: {
    hasStatus: false,
    hasContentAssignment: false,
    hasDomainMetadata: false,
  },
};

const CLIENT_CONFIG: Record<string, ClientConfig> = {
  procurement: {
    route: '/procurement',
    available: true,
    hasCustomCreation: true,
    features: {
      hasStatus: true,
      hasContentAssignment: true,
      hasDomainMetadata: true,
    },
  },
  intelligence: {
    route: '/intelligence',
    available: true,
    hasCustomCreation: true,
    features: {
      hasStatus: false,
      hasContentAssignment: true,
      hasDomainMetadata: true,
    },
  },
  sales_proposal: {
    route: null,
    available: false,
    hasCustomCreation: false,
    features: {
      hasStatus: false,
      hasContentAssignment: true,
      hasDomainMetadata: false,
    },
  },
};

// ---------------------------------------------------------------------------
// Icon-name → LucideIcon resolution map (TECH.md §4 Option C, Q-5 ratification)
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  newspaper: Newspaper,
  'file-signature': FileSignature,
};

/** Resolve a DB icon name to a LucideIcon. Falls back to Folder for unknowns. */
function resolveIcon(iconName: string | null): LucideIcon {
  if (!iconName) return Folder;
  return ICON_MAP[iconName] ?? Folder;
}

// ---------------------------------------------------------------------------
// Internal selector — joins wire row + static config + resolved icon
// ---------------------------------------------------------------------------

function toWorkspaceTypeConfig(row: ApplicationTypeRowWire): WorkspaceTypeConfig {
  const clientConfig = CLIENT_CONFIG[row.key] ?? PERMISSIVE_DEFAULT;
  return {
    // Normalised camelCase DB fields
    key: row.key,
    label: row.label,
    labelPlural: row.label_plural ?? row.label,
    description: row.description ?? '',
    defaultIcon: row.default_icon ?? '',
    defaultColour: row.default_colour ?? '',
    // Resolved icon
    icon: resolveIcon(row.default_icon),
    // Static client config
    route: clientConfig.route,
    available: clientConfig.available,
    hasCustomCreation: clientConfig.hasCustomCreation,
    features: clientConfig.features,
  };
}

// ---------------------------------------------------------------------------
// Shared query config — all 3 public hooks key off the same fetched dataset
// (queryKey is shared, so TanStack Query dedupes the fetch). Only the
// `select:` transformation varies per hook.
// ---------------------------------------------------------------------------

const APPLICATION_TYPES_STALE_TIME_MS = 5 * 60_000;

function useApplicationTypesQuery<T>(
  select: (rows: ApplicationTypeRowWire[]) => T,
) {
  return useQuery({
    queryKey: queryKeys.applicationTypes.list,
    queryFn: () => fetchJson<ApplicationTypeRowWire[]>('/api/application-types'),
    select,
    staleTime: APPLICATION_TYPES_STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/**
 * Fetches all application types from the DB, normalised to WorkspaceTypeConfig[].
 * Cache: staleTime 5 min (closed-list reference data, no invalidation triggers).
 */
export function useApplicationTypes() {
  return useApplicationTypesQuery((rows) => rows.map(toWorkspaceTypeConfig));
}

/**
 * Convenience wrapper returning a single WorkspaceTypeConfig by key.
 * Returns undefined for unknown keys (preserves getWorkspaceType() contract).
 */
export function useWorkspaceType(type: string) {
  return useApplicationTypesQuery((rows) =>
    rows.map(toWorkspaceTypeConfig).find((c) => c.key === type),
  );
}

/**
 * Returns application types that should appear on the launcher page.
 * Preserves getLauncherTypes() semantics: route !== null || !available.
 */
export function useLauncherTypes() {
  return useApplicationTypesQuery((rows) =>
    rows.map(toWorkspaceTypeConfig).filter((t) => t.route !== null || !t.available),
  );
}

// ---------------------------------------------------------------------------
// Sync utility (no hook — pure function, safe in non-render contexts)
// ---------------------------------------------------------------------------

/**
 * Format a count string for a workspace type.
 * Accepts WorkspaceTypeConfig | undefined so TanStack query results feed it directly.
 * Preserves formatTypeCount() contract from lib/workspace-types.ts.
 *
 * @example
 *   formatTypeCount(undefined, 0) → '0 active workspaces'
 *   formatTypeCount(intelligenceConfig, 3) → '3 active intelligence streams'
 */
export function formatTypeCount(
  config: WorkspaceTypeConfig | undefined,
  count: number,
): string {
  if (!config) return `${count} active workspace${count !== 1 ? 's' : ''}`;
  const noun =
    count === 1 ? config.label.toLowerCase() : config.labelPlural.toLowerCase();
  return `${count} active ${noun}`;
}
