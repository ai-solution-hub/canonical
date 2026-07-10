/**
 * nav-config — single source of truth for the three-zone navigation IA
 * (DR-041, id-118 TECH §C0).
 *
 * Both site-header.tsx (desktop bar + mobile drawer) and command-palette.tsx
 * import NAV_ZONES and the helpers below so the two surfaces stay
 * structurally in lockstep (BI-18/BI-19) rather than relying on a 3-place
 * manual edit. Data + pure helpers only — no JSX, no 'use client'.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Briefcase,
  FileBarChart,
  History,
  Library,
  Link2,
  Newspaper,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';

/** Replaces the legacy `requiresEdit` boolean with a three-value axis. */
export type NavVisibility = 'all' | 'edit' | 'admin';

export interface NavEntry {
  href: string;
  /** The BI-17 ratified user-facing string, single-sourced across surfaces. */
  label: string;
  icon: LucideIcon;
  visibility: NavVisibility;
  /** Command-palette search terms (cmdk `value=`). */
  keywords?: string;
  /** BI-8: defined in the IA but NOT rendered until its landing route ships. */
  reserved?: boolean;
}

export type NavZoneId = 'applications' | 'knowledge' | 'governance';

export interface NavZone {
  id: NavZoneId;
  /** BI-2 exact zone header strings, shown verbatim on every surface. */
  header: 'Applications' | 'Knowledge' | 'Governance';
  entries: readonly NavEntry[];
}

/**
 * Ratified membership (order per BI-4/BI-9/BI-11; labels per BI-17; gating
 * per BI-20/BI-21). Utilities — Home via BrandLogo (BI-12), the persistent
 * SearchBar (BI-13), Settings (BI-14) — are deliberately NOT represented
 * here; they stay bespoke per surface.
 */
export const NAV_ZONES: readonly NavZone[] = [
  {
    id: 'applications',
    header: 'Applications',
    entries: [
      {
        href: '/procurement',
        label: 'Procurement',
        icon: Briefcase,
        visibility: 'all',
      },
      {
        href: '/intelligence',
        label: 'Intelligence',
        icon: Newspaper,
        visibility: 'edit',
      },
    ],
  },
  {
    id: 'knowledge',
    header: 'Knowledge',
    entries: [
      {
        href: '/search',
        label: 'Search',
        icon: Search,
        visibility: 'all',
      },
      {
        href: '/library',
        label: 'Answers',
        icon: Library,
        visibility: 'all',
      },
      {
        href: '/reference',
        label: 'External sources',
        icon: Link2,
        visibility: 'all',
      },
      {
        href: '/okf',
        label: 'Concepts',
        icon: Waypoints,
        visibility: 'all',
        // BI-8: /okf has no landing route yet (id-132/id-138). Icon/label
        // pre-declared so enabling this later is a one-line `reserved` flip.
        reserved: true,
      },
    ],
  },
  {
    id: 'governance',
    header: 'Governance',
    entries: [
      {
        href: '/review',
        label: 'Review',
        icon: ShieldCheck,
        visibility: 'edit',
      },
      {
        href: '/coverage',
        label: 'Coverage',
        icon: BarChart3,
        visibility: 'edit',
      },
      {
        href: '/change-reports',
        // Preserves the current requiresEdit:false audience (BI-21); lowercase
        // "r" per the BI-17 ratified label.
        label: 'Change reports',
        icon: FileBarChart,
        visibility: 'all',
      },
      {
        href: '/activity',
        // OQ-T1 (S457 owner ruling): /activity is homeless today with no
        // current gate — all-authenticated is a no-op encoding, not a
        // behaviour change.
        label: 'Activity',
        icon: Activity,
        visibility: 'all',
      },
      {
        href: '/provenance',
        // New admin axis value — today only reachable via the palette's
        // canAdmin block.
        label: 'Provenance',
        icon: History,
        visibility: 'admin',
      },
    ],
  },
] as const;

/**
 * Shared visibility predicate so all three surfaces agree (BI-20/BI-21).
 * `all` is visible to everyone; `edit`/`admin` gate on the matching role flag.
 */
export function isEntryVisible(
  visibility: NavVisibility,
  role: { canEdit: boolean; canAdmin: boolean },
): boolean {
  switch (visibility) {
    case 'all':
      return true;
    case 'edit':
      return role.canEdit;
    case 'admin':
      return role.canAdmin;
  }
}

/**
 * Mirrors the existing site-header.tsx:114-120 active-leaf rule: an exact
 * match, or a nested path one level (or more) below the leaf's href.
 */
export function isEntryActive(href: string, pathname: string | null): boolean {
  return pathname === href || (pathname?.startsWith(href + '/') ?? false);
}

/** A zone is active when any of its member entries is active (BI-23/BI-24). */
export function isZoneActive(zone: NavZone, pathname: string | null): boolean {
  return zone.entries.some((entry) => isEntryActive(entry.href, pathname));
}

/**
 * Leaf href -> owning zone lookup, so callers (e.g. the {118.9} e2e harness)
 * can resolve a leaf's zone without threading a zone argument through the
 * call site.
 */
export function findZoneForHref(href: string): NavZone | undefined {
  return NAV_ZONES.find((zone) =>
    zone.entries.some((entry) => entry.href === href),
  );
}
