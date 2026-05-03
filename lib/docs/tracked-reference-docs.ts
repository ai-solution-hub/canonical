/**
 * Single source of truth for canonical reference and runbook docs whose
 * `<!-- Last verified: ... -->` header is enforced by the edit-coupled
 * freshness guard test (`__tests__/docs/reference-doc-edit-coupled-freshness.test.ts`)
 * and the `/update-docs` Step 6.5 path-mapping. Adding or removing a tracked
 * doc is a single-file change here — both consumers re-read this list.
 */

export const TRACKED_REFERENCE_DOCS = [
  'docs/reference/SCHEMA-QUICK-REFERENCE.md',
  'docs/reference/ai-integration-layers.md',
  'docs/reference/ai-integration-strategy.md',
  'docs/reference/classification-architecture.md',
  'docs/reference/classification-prompt.md',
  'docs/reference/data-entry-points.md',
  'docs/reference/entity-type-taxonomy-spec.md',
  'docs/reference/field-consumer-dependency-map.md',
  'docs/reference/state-of-the-product-change-log.md',
  'docs/reference/state-of-the-product-change-log-section-5.md',
  'docs/reference/state-of-the-product-change-log-section-8.md',
  'docs/reference/state-of-the-product-change-log-section-9.md',
  'docs/runbooks/local-development.md',
  'docs/runbooks/staging-refresh.md',
  'docs/runbooks/github-environments.md',
] as const;

export type TrackedReferenceDoc = (typeof TRACKED_REFERENCE_DOCS)[number];
