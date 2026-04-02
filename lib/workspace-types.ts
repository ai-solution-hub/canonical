import { Briefcase, FileText, FileSignature, Newspaper } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Configuration for a workspace type. Each registered type provides the
 * information needed to render it in the UI without any hardcoded checks.
 */
export interface WorkspaceTypeConfig {
  /** Database type value (matches workspaces.type CHECK constraint) */
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

  /** Whether this type has a dedicated creation flow (e.g. BidCreationWizard).
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
    console.warn(`Workspace type "${config.type}" is already registered`);
    return;
  }
  WORKSPACE_TYPE_REGISTRY[config.type] = config;
}

// ---- Built-in types ----

registerType({
  type: 'bid',
  label: 'Bid',
  labelPlural: 'Bids',
  description:
    'Manage bid responses and tender submissions using your knowledge base',
  icon: Briefcase,
  route: '/bid',
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
  type: 'kb_section',
  label: 'KB Section',
  labelPlural: 'KB Sections',
  description: 'Organise related content items into thematic sections',
  icon: FileText,
  route: null,
  available: true,
  hasCustomCreation: false,
  defaultColour: '#6366f1',
  defaultIcon: 'folder',
  features: {
    hasStatus: false,
    hasContentAssignment: true,
    hasDomainMetadata: false,
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
    'AI-filtered sector and competitor news feeds with configurable prompts',
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
 * Get the valid type values for Zod validation.
 * Only includes types that exist in the database (available types and those
 * with backing schema). Excludes placeholder types like 'proposal' that have
 * no DB CHECK constraint entry.
 */
export function getValidTypeValues(): [string, ...string[]] {
  const values = Object.keys(WORKSPACE_TYPE_REGISTRY).filter((key) => {
    const config = WORKSPACE_TYPE_REGISTRY[key];
    return config.available;
  });
  if (values.length === 0) throw new Error('No workspace types registered');
  return values as [string, ...string[]];
}

/** Format a count string for a workspace type (e.g. "3 active bids") */
export function formatTypeCount(type: string, count: number): string {
  const config = getWorkspaceType(type);
  if (!config) return `${count} active workspace${count !== 1 ? 's' : ''}`;
  const noun =
    count === 1 ? config.label.toLowerCase() : config.labelPlural.toLowerCase();
  return `${count} active ${noun}`;
}
