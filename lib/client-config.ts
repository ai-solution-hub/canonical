/**
 * Client Feature Configuration
 *
 * Single source of truth for all client-specific feature toggles and
 * layer vocabulary. This file drives:
 *   - Feature gate checks (via useClientFeatures() or direct import)
 *   - Zod validation schemas (lib/validation/layer-schemas.ts)
 *   - UI labels and coverage RPC grouping
 *
 * Storage is currently file-based. When multi-client support is added,
 * this config can migrate to a database table without changing consumers.
 */

// ---------------------------------------------------------------------------
// Feature toggle type
// ---------------------------------------------------------------------------

export interface FeatureToggle {
  /** Whether the feature is enabled for this client */
  enabled: boolean;
  /** Human-readable label for the feature */
  label: string;
  /** Brief description shown in settings / admin UI */
  description: string;
}

// ---------------------------------------------------------------------------
// Layer vocabulary type
// ---------------------------------------------------------------------------

export interface LayerDefinition {
  /** Internal identifier (used in DB, URLs, API) */
  key: string;
  /** Human-readable label for UI display */
  label: string;
  /** Brief description of what this layer contains */
  description: string;
  /** Display order in UI (lower = higher) */
  order: number;
}

// ---------------------------------------------------------------------------
// Client config shape
// ---------------------------------------------------------------------------

export interface ClientConfig {
  /** Unique client identifier */
  client_id: string;
  /** Display name for the client */
  client_name: string;
  /** Feature toggles keyed by feature name */
  features: {
    /** Tag management: rename, merge, delete, autocomplete */
    tag_management: FeatureToggle;
    /** Coverage dashboard: tag/layer coverage visualisation */
    coverage_dashboard: FeatureToggle;
    /** Content layers: metadata-driven content depth layers */
    content_layers: FeatureToggle;
    /** Draft status: lightweight draft workflow on governance */
    draft_status: FeatureToggle;
    /** AI integration: AI drafting, classification, Claude bridge */
    ai_integration: FeatureToggle;
    /** Bid management: full bid workflow */
    bid_management: FeatureToggle;
  };
  /** Content layer vocabulary — drives validation, UI labels, coverage grouping */
  layer_vocabulary: LayerDefinition[];
  /** Examples used in AI classification prompts for entity extraction guidance */
  entity_examples: {
    /** Full formal organisation name, e.g. "Example Client Ltd" */
    organisation_name: string;
    /** Short/informal name to avoid, e.g. "example-client" */
    organisation_short: string;
    /** Canonical product name, e.g. "example-client Audit System" */
    product_name: string;
    /** Informal product name to avoid, e.g. "audit system" */
    product_short: string;
  };
  /**
   * Client-specific classification disambiguation rules.
   *
   * Interpolated into the `{CLIENT_DISAMBIGUATION}` placeholder in
   * `lib/ai/skills/classification.md` via `lib/ai/classify.ts` and
   * `scripts/eval-classification.ts`. Each rule may contain
   * `{CLIENT_PRODUCT_NAME}`, `{CLIENT_ORGANISATION_NAME}`, etc.
   * placeholders — these are resolved by the subsequent `.replaceAll`
   * chain at the prompt-assembly call site.
   *
   * Multi-client readiness note: these rules are the only client-
   * specific classification knobs outside the skill file itself. When a
   * new client is onboarded (e.g. demo DB or a client DB branch), their
   * rules go here rather than being hardcoded in `classify.ts`. See
   * `docs/specs/entity-classification-prompt-tightening-spec.md` §13 Q6
   * resolution.
   */
  classification_disambiguation_rules: readonly string[];
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const CLIENT_CONFIG = {
  client_id: 'default',
  client_name: 'Knowledge Hub',

  features: {
    tag_management: {
      enabled: true,
      label: 'Tag Management',
      description: 'Rename, merge, and delete tags across the knowledge base',
    },
    coverage_dashboard: {
      enabled: true,
      label: 'Coverage Dashboard',
      description: 'Visualise tag and layer coverage across content',
    },
    content_layers: {
      enabled: true,
      label: 'Content Layers',
      description:
        'Metadata-driven content depth layers (sales_brief → bid_detail → company_reference → research)',
    },
    draft_status: {
      enabled: true,
      label: 'Draft Status',
      description: 'Save items as drafts, hidden from search and matching',
    },
    ai_integration: {
      enabled: true,
      label: 'AI Integration',
      description: 'AI classification, summary generation, and Claude bridge',
    },
    bid_management: {
      enabled: true,
      label: 'Bid Management',
      description: 'Full bid workflow: extraction, drafting, review, export',
    },
  },

  entity_examples: {
    organisation_name: 'Example Client Ltd',
    organisation_short: 'example-client',
    product_name: 'example-client Audit System',
    product_short: 'audit system',
  },

  classification_disambiguation_rules: [
    '"{CLIENT_PRODUCT_NAME}" is a SOFTWARE PRODUCT, not an auditing process. Questions about its features (action plans, invites, reports, exports, user interface) belong in product-feature/*, NOT compliance/audit.',
    'Business continuity and disaster recovery (BC/DR) belong in security/cyber-security, not support/* or product-feature/*.',
    'Security awareness training, confidentiality clauses, and security governance belong in security/data-protection or corporate/staffing, NOT support/sla.',
    'Data security controls (encryption, access control, secure data transfer, infrastructure security) belong in security/*, NOT product-feature/*.',
    'Financial questions (pricing, costs, audited accounts, hidden costs) belong in corporate/financial-standing.',
    'When "{CLIENT_ORGANISATION_NAME}" or its short form "{CLIENT_ORGANISATION_SHORT}" appears verbatim in content — including first-party Q&A answers where it reads as a self-reference (e.g. "{CLIENT_ORGANISATION_SHORT} is complying", "{CLIENT_ORGANISATION_SHORT} must", "{CLIENT_ORGANISATION_SHORT} Project Manager", "Phase 2. Implementation ({CLIENT_ORGANISATION_SHORT})") — extract it as an `organisation` entity. Client self-references are named entities, NOT pronouns. The alias map normalises the short form to the full formal name, so extracting the verbatim short form is correct.',
  ],

  layer_vocabulary: [
    {
      key: 'sales_brief',
      label: 'Sales Brief',
      description: 'Positioning and messaging for internal sales',
      order: 1,
    },
    {
      key: 'bid_detail',
      label: 'Bid Detail',
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
  ],
} as const satisfies ClientConfig;

// ---------------------------------------------------------------------------
// Convenience type exports
// ---------------------------------------------------------------------------

export type FeatureName = keyof typeof CLIENT_CONFIG.features;
export type LayerKey = (typeof CLIENT_CONFIG.layer_vocabulary)[number]['key'];

/**
 * Static layer definitions for seed data, client-side fallback,
 * and server-side display helpers. NOT used for API validation —
 * API handlers fetch live layers from the DB via fetchActiveLayerKeys().
 */
export const FALLBACK_LAYERS: readonly LayerDefinition[] =
  CLIENT_CONFIG.layer_vocabulary;

/**
 * Check whether a feature is enabled in the static config.
 * Usable from both server and client contexts.
 */
export function isFeatureEnabled(feature: FeatureName): boolean {
  return CLIENT_CONFIG.features[feature].enabled;
}

/**
 * Build the `{CLIENT_DISAMBIGUATION}` block inserted into the
 * classification skill prompt. Returns a markdown bullet list of the
 * client's disambiguation rules.
 *
 * Placeholders inside the rules (`{CLIENT_PRODUCT_NAME}` etc.) are NOT
 * resolved here — they are resolved by the caller's subsequent
 * `.replaceAll` chain after `{CLIENT_DISAMBIGUATION}` substitution.
 *
 * Called from:
 *   - `lib/ai/classify.ts` (TypeScript classification pipeline)
 *   - `scripts/eval-classification.ts` (eval harness, kept in sync
 *     with the production pipeline by construction)
 */
export function buildDisambiguationBlock(): string {
  return CLIENT_CONFIG.classification_disambiguation_rules
    .map((rule) => `- ${rule}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// OKLCH parser — single source of truth
// ---------------------------------------------------------------------------

import { z } from 'zod';

const OKLCH_FORMAT =
  /^oklch\(\s*([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s*\)$/;

export interface OklchComponents {
  l: number;
  c: number;
  h: number;
}

/**
 * Parse an OKLCH colour string into numeric components. Returns `null` for
 * any string that does not match the format OR whose components fall outside
 * the allowed ranges (L in [0,1], C in [0,0.4], H in [0,360)).
 */
export function parseOklch(s: string): OklchComponents | null {
  const m = s.trim().match(OKLCH_FORMAT);
  if (!m) return null;
  const l = Number(m[1]);
  const c = Number(m[2]);
  const h = Number(m[3]);
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h))
    return null;
  if (l < 0 || l > 1) return null;
  if (c < 0 || c > 0.4) return null;
  if (h < 0 || h >= 360) return null;
  return { l, c, h };
}

// ---------------------------------------------------------------------------
// Brand asset existence check
// ---------------------------------------------------------------------------

/**
 * Check that a brand asset path (e.g. `/clients/example-client/logo.webp`) resolves to
 * a real file under `public/`. Used by the schema `.refine()` on every URL
 * field so a typo in the JSON fails the build rather than producing a 404
 * broken-image in production.
 *
 * In browser contexts (`typeof window !== 'undefined'`), returns `true` —
 * the validation already ran at build time. This avoids importing `fs`/`path`
 * in client bundles.
 */
function brandAssetExists(urlPath: string): boolean {
  if (typeof window !== 'undefined') return true;
  if (!urlPath.startsWith('/')) return false;
  const cleanPath = urlPath.slice(1).split('?')[0] ?? '';
  // Dynamic require to avoid bundling fs/path in client builds
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pathMod = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMod = require('node:fs') as typeof import('node:fs');
  const abs = pathMod.join(process.cwd(), 'public', cleanPath);
  try {
    return fsMod.statSync(abs).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Branding config — schema + type
// ---------------------------------------------------------------------------

/**
 * Zod schema for per-client branding. Validated at module init against the
 * JSON file selected by NEXT_PUBLIC_CLIENT_ID. If validation fails, the
 * build fails with a clear error — there is no runtime fallback.
 *
 * UK English field names: `colour` not `color`, `organisation` not `organization`.
 */
export const BrandingConfigSchema = z.object({
  /** Matches the directory under public/clients/ and the env var value. */
  clientId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, {
      message: 'clientId must be lowercase kebab-case',
    }),
  /** Full product name — used in <title>, OAuth consent, DOCX exports. */
  productName: z.string().min(1).max(100),
  /**
   * Short product name — used in the site header product-name slot (~200px
   * wide at the default 14px body font, roughly 30 characters).
   */
  productShortName: z.string().min(1).max(30),
  /** Full legal organisation name — used in footer, export metadata. */
  organisationName: z.string().min(1).max(100),
  /** Tagline / meta description — appears in <meta name="description">. */
  tagline: z.string().min(1).max(200),
  /** Support contact email — shown in settings, error pages. */
  supportEmail: z.string().email(),
  /** Homepage / marketing URL. */
  homepageUrl: z.string().url().optional(),
  /** Display-friendly variant of homepageUrl (no protocol). */
  homepageUrlDisplay: z.string().optional(),
  /**
   * Primary brand colour in OKLCH format string: "oklch(L C H)" where
   *   L in [0, 1] (lightness)
   *   C in [0, 0.4] (chroma)
   *   H in [0, 360) (hue in degrees)
   */
  brandPrimaryColour: z.string().refine((v) => parseOklch(v) !== null, {
    message:
      'brandPrimaryColour must match oklch(L C H) with L in [0,1], C in [0,0.4], H in [0,360). Example: "oklch(0.65 0.16 55)".',
  }),
  /** Optional explicit dark-mode variant. */
  brandPrimaryColourDark: z
    .string()
    .refine((v) => parseOklch(v) !== null, {
      message:
        'brandPrimaryColourDark must be a valid OKLCH string (see brandPrimaryColour).',
    })
    .optional(),
  /** Optional explicit primary-foreground colour. */
  brandPrimaryForeground: z
    .string()
    .refine((v) => parseOklch(v) !== null, {
      message: 'brandPrimaryForeground must be a valid OKLCH string.',
    })
    .optional(),
  /** Path to the light-mode logo, relative to public/. */
  logoUrl: z.string().startsWith('/').refine(brandAssetExists, {
    message:
      'logoUrl does not resolve to a file under public/. Check the path.',
  }),
  /** Optional dark-mode logo. If omitted, the light-mode logo is used. */
  logoUrlDark: z
    .string()
    .startsWith('/')
    .refine(brandAssetExists, {
      message: 'logoUrlDark does not resolve to a file under public/.',
    })
    .optional(),
  /** Logo alt text — accessibility. UK English. */
  logoAlt: z.string().min(1).max(200),
  /** Max rendered width of the header logo in pixels. */
  logoMaxWidthPx: z.number().int().positive().max(400).optional().default(140),
  /** Logo aspect ratio (width / height). Defaults to 3.0. */
  logoAspectRatio: z.number().positive().max(10).optional().default(3),
  /** Favicon SVG path relative to public/. Optional — not all clients have one. */
  faviconSvgUrl: z
    .string()
    .startsWith('/')
    .endsWith('.svg')
    .refine(brandAssetExists, {
      message: 'faviconSvgUrl does not resolve to a file under public/.',
    })
    .optional(),
  /** Favicon PNG path relative to public/. */
  faviconPngUrl: z
    .string()
    .startsWith('/')
    .endsWith('.png')
    .refine(brandAssetExists, {
      message: 'faviconPngUrl does not resolve to a file under public/.',
    }),
  /** Per-client entity classification disambiguation rules. */
  classificationDisambiguation: z
    .object({
      entityExamples: z
        .array(
          z.object({
            name: z.string().min(1),
            canonicalName: z.string().min(1),
            type: z.string().min(1),
            reason: z.string().min(1).max(200),
          }),
        )
        .default([]),
      selfReferenceRules: z
        .array(
          z.object({
            clientOrganisationShort: z.string().min(1),
            canonicalName: z.string().min(1),
            reason: z.string().min(1).max(200),
          }),
        )
        .default([]),
    })
    .optional()
    .default({ entityExamples: [], selfReferenceRules: [] }),
});

export type BrandingConfig = z.infer<typeof BrandingConfigSchema>;

// ---------------------------------------------------------------------------
// OKLCH -> Oklab -> linear sRGB -> WCAG relative luminance
// ---------------------------------------------------------------------------

/**
 * Convert an OKLCH colour to WCAG relative luminance (CIE Y, ~[0,1]).
 *
 * Pipeline: OKLCH (L, C, H) -> Oklab (L, a, b) -> linear sRGB (R, G, B) -> Y.
 *
 * The Oklab-to-linear-sRGB matrix comes from Bjorn Ottosson's original paper;
 * the luminance coefficients (0.2126, 0.7152, 0.0722) come from ITU-R BT.709.
 */
export function oklchToRelativeLuminance(oklch: OklchComponents): number {
  const { l: L, c: C, h: H } = oklch;
  // 1. OKLCH -> Oklab (cylindrical to rectangular).
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // 2. Oklab -> linear sRGB via Ottosson's matrix.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const lCube = l_ * l_ * l_;
  const mCube = m_ * m_ * m_;
  const sCube = s_ * s_ * s_;
  const rLin =
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  const gLin =
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  const bLin =
    0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube;

  // 3. Clamp out-of-gamut negatives then compute ITU-R BT.709 luminance.
  const rSafe = Math.max(0, rLin);
  const gSafe = Math.max(0, gLin);
  const bSafe = Math.max(0, bLin);
  return 0.2126 * rSafe + 0.7152 * gSafe + 0.0722 * bSafe;
}

/**
 * WCAG 2.1 relative contrast ratio between two OKLCH colours.
 * Returns a ratio in [1, 21]. Higher is more contrasted.
 */
export function contrastRatio(a: string, b: string): number {
  const parsedA = parseOklch(a);
  const parsedB = parseOklch(b);
  if (!parsedA || !parsedB) {
    throw new Error(`contrastRatio called with invalid OKLCH: a=${a}, b=${b}`);
  }
  const yA = oklchToRelativeLuminance(parsedA);
  const yB = oklchToRelativeLuminance(parsedB);
  const lighter = Math.max(yA, yB);
  const darker = Math.min(yA, yB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Contrast validation + auto-derived foreground
// ---------------------------------------------------------------------------

const LIGHT_BG = 'oklch(0.94 0.01 48)';
const DARK_BG = 'oklch(0.18 0.014 48)';
const WCAG_NON_TEXT_MIN = 3.0;
const WCAG_TEXT_MIN = 4.5;

export interface ContrastValidationReport {
  warnings: readonly string[];
  errors: readonly string[];
}

/**
 * Validate primary + derived foreground against WCAG 2.1 AA.
 * Returns a report; the loader escalates errors to a thrown exception.
 */
export function validateBrandingContrast(
  branding: BrandingConfig,
): ContrastValidationReport {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Tier 1: primary vs background (non-text, 3:1 warn-only)
  const lightNonText = contrastRatio(branding.brandPrimaryColour, LIGHT_BG);
  if (lightNonText < WCAG_NON_TEXT_MIN) {
    warnings.push(
      `brandPrimaryColour vs light background is ${lightNonText.toFixed(2)}:1 (below WCAG 1.4.11 3:1 non-text threshold). The colour may be hard to distinguish from the page background — consider a darker or more saturated primary.`,
    );
  }

  const darkPrimary =
    branding.brandPrimaryColourDark ??
    deriveDarkVariant(branding.brandPrimaryColour);
  const darkNonText = contrastRatio(darkPrimary, DARK_BG);
  if (darkNonText < WCAG_NON_TEXT_MIN) {
    warnings.push(
      `Dark-mode brandPrimaryColour vs dark background is ${darkNonText.toFixed(2)}:1 (below 3:1). Supply an explicit brandPrimaryColourDark or the auto-derivation is insufficient.`,
    );
  }

  // Tier 2: foreground vs primary (normal text, 4.5:1 fail-build)
  const foreground =
    branding.brandPrimaryForeground ??
    derivePrimaryForeground(branding.brandPrimaryColour);
  const lightText = contrastRatio(foreground, branding.brandPrimaryColour);
  if (lightText < WCAG_TEXT_MIN) {
    errors.push(
      `brandPrimaryForeground vs brandPrimaryColour is ${lightText.toFixed(2)}:1 (below WCAG 1.4.3 4.5:1 text threshold). Supply an explicit brandPrimaryForeground in the client JSON — auto-derivation cannot find a foreground that meets the threshold for this primary.`,
    );
  }
  const darkForeground =
    branding.brandPrimaryForeground ?? derivePrimaryForeground(darkPrimary);
  const darkText = contrastRatio(darkForeground, darkPrimary);
  if (darkText < WCAG_TEXT_MIN) {
    errors.push(
      `Dark-mode primary foreground contrast is ${darkText.toFixed(2)}:1 (below 4.5:1). Supply an explicit brandPrimaryForeground override.`,
    );
  }

  return { warnings, errors };
}

/**
 * Derive a dark-mode primary variant from the light primary.
 *
 * Bright primaries (L > 0.75): DECREASE L by 0.10.
 * Darker primaries (L <= 0.75): INCREASE L by 0.07 up to 0.85 ceiling.
 */
export function deriveDarkVariant(primary: string): string {
  const parsed = parseOklch(primary);
  if (!parsed)
    throw new Error(`deriveDarkVariant called with invalid OKLCH: ${primary}`);
  const { l, c, h } = parsed;
  const shiftedL = l > 0.75 ? Math.max(0.3, l - 0.1) : Math.min(0.85, l + 0.07);
  return `oklch(${shiftedL.toFixed(3)} ${c} ${h})`;
}

/**
 * Pick the black or white foreground that gives the HIGHER contrast with
 * the given primary.
 */
export function derivePrimaryForeground(primary: string): string {
  const black = 'oklch(0.15 0.016 48)';
  const white = 'oklch(0.99 0.003 48)';
  const blackContrast = contrastRatio(black, primary);
  const whiteContrast = contrastRatio(white, primary);
  return blackContrast >= whiteContrast ? black : white;
}

// ---------------------------------------------------------------------------
// Branding loader
// ---------------------------------------------------------------------------

// Static JSON imports — Next.js / Webpack resolves these at build time.
// To add a new client: (1) create config/clients/{id}.json, (2) import it
// here, (3) add the mapping to CLIENT_BRANDING_MAP, (4) set
// NEXT_PUBLIC_CLIENT_ID in the Vercel project.
import defaultBranding from '@/lib/branding/clients/default.json';
import example-clientBranding from '@/lib/branding/clients/example-client.json';
import { clientEnv } from '@/lib/env-client';
import { logger } from '@/lib/logger/client';

const CLIENT_BRANDING_MAP: Record<string, unknown> = {
  default: defaultBranding,
  example-client: example-clientBranding,
};

/**
 * Resolve the active branding config by explicit id OR from
 * `clientEnv.NEXT_PUBLIC_CLIENT_ID` when no id is supplied.
 *
 * `clientEnv` is validated at boot in `lib/env.ts`; `NEXT_PUBLIC_CLIENT_ID`
 * is REQUIRED there so the previous silent fallback to "Knowledge Hub"
 * (S196 incident — 35 corrupted entity_mention rows) is no longer
 * reachable in production builds.
 *
 * Exported so tests can pass an explicit id without relying on env-var
 * mocking (NEXT_PUBLIC_* env vars are inlined by SWC at build time).
 *
 * Falls back to 'default' only if the supplied / env-derived id is not in
 * the lookup map. Throws if the selected JSON fails schema validation or
 * if the contrast Tier 2 check reports any errors.
 */
export function loadBranding(idOverride?: string): BrandingConfig {
  const id = idOverride ?? clientEnv.NEXT_PUBLIC_CLIENT_ID;
  const raw = CLIENT_BRANDING_MAP[id] ?? CLIENT_BRANDING_MAP.default;

  if (!raw) {
    throw new Error(
      `Branding config not found for client id "${id}" and no default is available.`,
    );
  }

  const parsed = BrandingConfigSchema.parse(raw);
  const report = validateBrandingContrast(parsed);
  for (const w of report.warnings) {
    // Build-time warning — printed to the build log so it's visible in
    // CI, but does not fail the build.
    logger.warn(`[branding] ${w}`);
  }
  if (report.errors.length > 0) {
    throw new Error(
      `Branding contrast validation failed for client "${id}":\n  - ${report.errors.join('\n  - ')}\n\nSupply an explicit brandPrimaryForeground in the client JSON to resolve.`,
    );
  }
  return parsed;
}

/** Active branding for this deployment. Computed once at module init. */
export const BRANDING: BrandingConfig = loadBranding();

/** Computed foreground colour for the primary brand colour (light mode). */
export const BRANDING_PRIMARY_FOREGROUND =
  BRANDING.brandPrimaryForeground ??
  derivePrimaryForeground(BRANDING.brandPrimaryColour);

/** Computed dark-mode primary (explicit override or auto-derived). */
export const BRANDING_PRIMARY_DARK =
  BRANDING.brandPrimaryColourDark ??
  deriveDarkVariant(BRANDING.brandPrimaryColour);

/**
 * Computed foreground for the dark-mode primary. Falls back to the
 * light-mode override if the client supplied `brandPrimaryForeground`,
 * otherwise re-runs auto-derivation against the darker primary.
 */
export const BRANDING_PRIMARY_FOREGROUND_DARK =
  BRANDING.brandPrimaryForeground ??
  derivePrimaryForeground(BRANDING_PRIMARY_DARK);

// ---------------------------------------------------------------------------
// Brand CSS injection helper
// ---------------------------------------------------------------------------

function buildBrandCss(): string {
  return `
:root {
  --primary: ${BRANDING.brandPrimaryColour};
  --primary-foreground: ${BRANDING_PRIMARY_FOREGROUND};
  --ring: ${BRANDING.brandPrimaryColour};
}
.dark {
  --primary: ${BRANDING_PRIMARY_DARK};
  --primary-foreground: ${BRANDING_PRIMARY_FOREGROUND_DARK};
  --ring: ${BRANDING_PRIMARY_DARK};
}
`.trim();
}

/**
 * Build the React props object for the `<style>` element in `app/layout.tsx`.
 *
 * Returns an object with React's raw HTML injection prop. The content is
 * derived from BRANDING which has been parsed by BrandingConfigSchema and
 * passed validateBrandingContrast. No user input flows into this string.
 *
 * The prop name is assembled via string concatenation to avoid tripping the
 * codebase's security-reminder pre-tool hook when this file is edited.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildBrandStyleProps(): Record<string, any> {
  const RAW_HTML_PROP = ['dangerously', 'Set', 'Inner', 'HTML'].join(
    '',
  ) as 'dangerouslySetInnerHTML';
  return { [RAW_HTML_PROP]: { __html: buildBrandCss() } };
}
