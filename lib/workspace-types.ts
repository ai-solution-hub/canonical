import { Briefcase, FileSignature, Newspaper } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { logger } from '@/lib/logger/client';

// Post-T4 (S248): `getValidTypeValues()` returns the 6 application_types
// seed keys hardcoded (sync-callable at module-load for Zod). The static
// `WORKSPACE_TYPE_REGISTRY` registry is retained as a UI metadata helper
// for the 3 currently-rendered workspace types (procurement / intelligence
// / proposal). Full TanStack Query migration of UI helpers against
// application_types is a follow-up — tracked as a backlog item rather
// than blocking T4 close.

/**
 * Configuration for a workspace type. Each registered type provides the
 * information needed to render it in the UI without any hardcoded checks.
 */
/** @public */
export interface WorkspaceTypeConfig {
  /** Application-type key (matches `application_types.key`) — used to be the
   *  `workspaces.type` CHECK constraint value pre-T2. */
  readonly type: string;

  /** Human-readable label (singular) */
  readonly label: string;

  /** Human-readable label (plural) */
  readonly labelPlural: string;

  /** Short description shown on the launcher card */
  readonly description: string;

  /** Lucide icon component */
  readonly icon: LucideIcon;

  /** Route for the dedicated workspace list/management page, or null */
  readonly route: string | null;

  /** Whether this type is available for use (false = "Coming soon") */
  readonly available: boolean;

  /** Whether this type has a dedicated creation flow (e.g. ProcurementCreationWizard).
   *  If true, the generic WorkspaceCreateDialog delegates to the type-specific
   *  creation flow. */
  readonly hasCustomCreation: boolean;

  /** Default colour for new workspaces of this type */
  readonly defaultColour: string;

  /** Default icon name for new workspaces of this type */
  readonly defaultIcon: string;

  /** Features this workspace type supports */
  readonly features: {
    /** Has a status/lifecycle state machine */
    readonly hasStatus: boolean;
    /** Supports content item assignment via junction table */
    readonly hasContentAssignment: boolean;
    /** Has type-specific domain_metadata schema */
    readonly hasDomainMetadata: boolean;
  };
}

/** All registered workspace types */
const WORKSPACE_TYPE_REGISTRY: Record<string, WorkspaceTypeConfig> = {};

/** Register a workspace type. Called at module init time. */
function registerType(config: WorkspaceTypeConfig): void {
  if (WORKSPACE_TYPE_REGISTRY[config.type]) {
    logger.warn(`Workspace type "${config.type}" is already registered`);
    return;
  }
  WORKSPACE_TYPE_REGISTRY[config.type] = config;
}

// ---- Built-in types ----

// Post-T2: 'bid' renamed to 'procurement' per Q-OQR1-02 application_types.key
// mapping. 'kb_section' was retired (no prod rows).
// TODO(T4): replace static registry with application_types TanStack Query per
// PLAN §4.4.
registerType({
  type: 'procurement',
  label: 'Procurement',
  labelPlural: 'Procurements',
  description:
    'Manage bid responses and tender submissions using your knowledge base',
  icon: Briefcase,
  route: '/procurement',
  available: true,
  hasCustomCreation: true,
  defaultColour: '#d4880f',
  defaultIcon: 'briefcase',
  features: {
    hasStatus: true,
    hasContentAssignment: true,
    hasDomainMetadata: true,
  },
});

registerType({
  type: 'proposal',
  label: 'Sales Proposal',
  labelPlural: 'Sales Proposals',
  description:
    'Draft and manage sales proposals drawing on your knowledge base',
  icon: FileSignature,
  route: null,
  available: false,
  hasCustomCreation: false,
  defaultColour: '#0d9488',
  defaultIcon: 'file-signature',
  features: {
    hasStatus: false,
    hasContentAssignment: true,
    hasDomainMetadata: false,
  },
});

registerType({
  type: 'intelligence',
  label: 'Intelligence Stream',
  labelPlural: 'Intelligence Streams',
  description:
    'Sector and competitor news feeds tailored to your company profile.',
  icon: Newspaper,
  route: '/intelligence',
  available: true,
  hasCustomCreation: true,
  defaultColour: '#059669',
  defaultIcon: 'globe',
  features: {
    hasStatus: false,
    hasContentAssignment: true,
    hasDomainMetadata: true,
  },
});

// ---- Public API ----

/** Get config for a specific workspace type. Returns undefined if not found. */
export function getWorkspaceType(
  type: string,
): WorkspaceTypeConfig | undefined {
  return WORKSPACE_TYPE_REGISTRY[type];
}

/** Get all registered workspace types as an array, ordered for display. */
export function getAllWorkspaceTypes(): WorkspaceTypeConfig[] {
  return Object.values(WORKSPACE_TYPE_REGISTRY);
}

/** Get workspace types that should appear on the launcher page. */
export function getLauncherTypes(): WorkspaceTypeConfig[] {
  return Object.values(WORKSPACE_TYPE_REGISTRY).filter(
    (t) => t.route !== null || !t.available,
  );
}

/**
 * Six application_types seed keys (matches `application_types.key` per T2
 * migration S246/S247). Source of truth is the DB table; this constant is
 * the sync-callable equivalent used by Zod schema construction at module
 * load (`lib/validation/schemas.ts:535`). Update both lists in lockstep
 * if a seed key is added or retired.
 */
export const APPLICATION_TYPE_KEYS = [
  'procurement',
  'intelligence',
  'sales_proposal',
  'product_guide',
  'competitor_research',
  'training_onboarding',
] as const;

/**
 * Get the valid type values for Zod validation.
 * Returns the 6 application_types seed keys hardcoded — sync-callable
 * equivalent of `SELECT key FROM application_types`. Async DB-driven
 * validation belongs in route handlers, not module-load-time Zod.
 */
export function getValidTypeValues(): [string, ...string[]] {
  return APPLICATION_TYPE_KEYS as unknown as [string, ...string[]];
}

/** Format a count string for a workspace type (e.g. "3 active procurements") */
export function formatTypeCount(type: string, count: number): string {
  const config = getWorkspaceType(type);
  if (!config) return `${count} active workspace${count !== 1 ? 's' : ''}`;
  const noun =
    count === 1 ? config.label.toLowerCase() : config.labelPlural.toLowerCase();
  return `${count} active ${noun}`;
}
