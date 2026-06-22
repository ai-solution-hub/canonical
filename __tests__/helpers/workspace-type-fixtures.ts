/**
 * Shared application_types fixtures + fetch stub for `useApplicationTypes`-
 * consuming tests.
 *
 * Extracted in S256 to deduplicate ~360 lines of identical boilerplate across
 * `__tests__/hooks/workspaces/use-application-types.test.ts`,
 * `__tests__/app/workspaces/workspaces-content.test.tsx`, and
 * `__tests__/app/workspaces/workspaces-launcher.test.tsx`. Per S255 W1
 * Checker recommendation ("deduplication is appropriate as a follow-on nit
 * before 29.8 lands").
 *
 * Wire shape mirrors the GET /api/application-types response — snake_case
 * verbatim, per `app/api/application-types/route.ts`. The hook's `select:`
 * callback normalises snake_case → camelCase + joins the static client
 * config; see `hooks/workspaces/use-application-types.ts`.
 *
 * For the QueryClient wrapper, use `createQueryWrapper()` from
 * `__tests__/helpers/query-wrapper.tsx` (the project-wide convention).
 */
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Wire-shape fixture (matches GET /api/application-types verbatim)
// ---------------------------------------------------------------------------

/** Row shape returned by GET /api/application-types. */
export interface ApplicationTypeWireRow {
  key: string;
  label: string;
  label_plural: string | null;
  description: string | null;
  default_icon: string | null;
  default_colour: string | null;
}

/**
 * The 6 seed rows returned by GET /api/application-types (snake_case).
 * Matches the `application_types` table seed exactly.
 */
export const SEED_APPLICATION_TYPE_ROWS: ApplicationTypeWireRow[] = [
  {
    key: 'procurement',
    label: 'Procurement',
    label_plural: 'Procurements',
    description:
      'Manage bid responses and tender submissions using your knowledge base',
    default_icon: 'briefcase',
    default_colour: '#d4880f',
  },
  {
    key: 'intelligence',
    label: 'Intelligence Stream',
    label_plural: 'Intelligence Streams',
    description:
      'Sector and competitor news feeds tailored to your company profile.',
    default_icon: 'newspaper',
    default_colour: '#059669',
  },
  {
    key: 'sales_proposal',
    label: 'Sales Proposal',
    label_plural: 'Sales Proposals',
    description:
      'Draft and manage sales proposals drawing on your knowledge base',
    default_icon: 'file-signature',
    default_colour: '#0d9488',
  },
  {
    key: 'product_guide',
    label: 'Product Guide',
    label_plural: 'Product Guides',
    description: 'Product Guide',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'competitor_research',
    label: 'Competitor Research',
    label_plural: 'Competitor Researchs',
    description: 'Competitor Research',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'training_onboarding',
    label: 'Training Onboarding',
    label_plural: 'Training Onboardings',
    description: 'Training Onboarding',
    default_icon: null,
    default_colour: null,
  },
];

// ---------------------------------------------------------------------------
// Fetch stub
// ---------------------------------------------------------------------------

/**
 * Stub `global.fetch` so any GET to `/api/application-types` returns the
 * supplied rows (defaults to `SEED_APPLICATION_TYPE_ROWS`).
 *
 * Returns the underlying mock so callers can assert call counts/args.
 *
 * Usage:
 * ```ts
 * beforeEach(() => { stubApplicationTypesFetch(); });
 * afterEach(() => { vi.unstubAllGlobals(); });
 * ```
 */
export function stubApplicationTypesFetch(
  rows: ApplicationTypeWireRow[] = SEED_APPLICATION_TYPE_ROWS,
): ReturnType<typeof vi.fn> {
  const mockFetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    url,
    json: async () => rows,
  }));
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}
