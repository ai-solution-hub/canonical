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
  Inbox,
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

/**
 * BI-2 exact zone header strings, keyed by zone id — the single place the
 * id/header pairing is declared.
 */
type NavZoneHeaderMap = {
  applications: 'Applications';
  knowledge: 'Knowledge';
  governance: 'Governance';
};

/**
 * Discriminated union keyed by `NavZoneId` (id-118.11 fold-in): each member's
 * `header` is tied to its `id` via `NavZoneHeaderMap`, so a mispaired literal
 * (e.g. `id: 'applications'` with `header: 'Governance'`) is a compile error
 * rather than relying solely on the table-driven nav-config.test.ts anchor.
 * Zero behaviour change — NAV_ZONES values are untouched (TECH C0).
 */
export type NavZone = {
  [Id in NavZoneId]: {
    id: Id;
    header: NavZoneHeaderMap[Id];
    entries: readonly NavEntry[];
  };
}[NavZoneId];

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
        // {132.32} G-LANDING-IMPL (LI-7/LI-8): the /okf landing route has
        // shipped (app/okf/page.tsx) — the one-line `reserved` flip BI-8
        // anticipated. No other edit needed; visibleZoneEntries admits the
        // entry and it propagates to the desktop bar, mobile drawer, and
        // Cmd+K palette via the single-source NAV_ZONES registry.
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
        // ID-145 {145.22} (TECH §5/§7 section I, BI-38/39, BI-48): thin
        // promotion-gate UI composing the existing q_a_extractions_
        // promotion_candidates() RPC + promote-corpus route + dedup-proposals
        // queue. Same admin/editor gate as the surface itself
        // (getAuthorisedClient(['admin','editor'])) — 'edit' visibility
        // mirrors Review/Coverage, the other review-queue entries.
        href: '/promotion-gate',
        label: 'Promotion gate',
        icon: Inbox,
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
        // OQ-118-A sibling finding (id-118.12, S460): the S457 "homeless,
        // no current gate" assumption no longer holds — /activity now
        // redirects to /provenance?tab=audit, whose whole page is
        // canAdmin-gated (matches the Settings system-group convention:
        // Team / Quality Review / Provenance are all admin-only). Flipped
        // to admin so the nav entry does not silently promise access the
        // destination denies (BI-21 no silent audience change).
        label: 'Activity',
        icon: Activity,
        visibility: 'admin',
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
 * The render filter shared by every nav surface (BI-18/BI-19 lockstep): an
 * entry renders only when it is not a reserved slot (BI-8) and its
 * visibility admits the caller's role (BI-20/BI-21).
 */
export function visibleZoneEntries(
  zone: NavZone,
  role: { canEdit: boolean; canAdmin: boolean },
): NavEntry[] {
  return zone.entries.filter(
    (entry) => !entry.reserved && isEntryVisible(entry.visibility, role),
  );
}

/**
 * Active-leaf rule (BI-23): an exact match, or a nested path one level (or
 * more) below the leaf's href.
 */
export function isEntryActive(href: string, pathname: string | null): boolean {
  return pathname === href || (pathname?.startsWith(href + '/') ?? false);
}

/** A zone is active when any of its member entries is active (BI-23/BI-24). */
export function isZoneActive(zone: NavZone, pathname: string | null): boolean {
  return zone.entries.some((entry) => isEntryActive(entry.href, pathname));
}

/**
 * Leaf href -> owning zone lookup, so a caller can resolve a leaf's zone
 * without threading a zone argument through the call site. Exact href match
 * only — nested subpaths do not resolve.
 */
export function findZoneForHref(href: string): NavZone | undefined {
  return NAV_ZONES.find((zone) =>
    zone.entries.some((entry) => entry.href === href),
  );
}
