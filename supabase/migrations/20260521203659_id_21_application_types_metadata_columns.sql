-- =============================================================================
-- ID-21 — application_types metadata columns (label_plural, description)
-- =============================================================================
-- Adds the two metadata columns that currently live in the static
-- `WORKSPACE_TYPE_REGISTRY` (lib/workspace-types.ts). Backfills the 6 seed
-- rows. No data loss — the static registry remains the source of truth
-- until §5 step 5 deletes it; this migration writes the same values the
-- registry holds so the hook output matches today's UI output byte-for-byte
-- for the 3 currently-rendered types.
--
-- Path c posture: see docs/specs/tanstack-workspace-types/TECH.md
-- =============================================================================

SET search_path = public, extensions;

BEGIN;

ALTER TABLE public.application_types
  ADD COLUMN label_plural text NULL,
  ADD COLUMN description text NULL;

-- Backfill from current static registry values.
-- procurement / intelligence / sales_proposal (= "proposal" in registry)
-- get exact labels. Other 3 seed rows take reasonable defaults derived from
-- the `label` column; the UI does not render them today so cosmetic drift
-- is acceptable (Q-OQR1-13 admin UI will let clients fix in v1.1).
UPDATE public.application_types SET
  label_plural = 'Procurements',
  description  = 'Manage bid responses and tender submissions using your knowledge base',
  default_icon = 'briefcase',
  default_colour = '#d4880f'
WHERE key = 'procurement';

UPDATE public.application_types SET
  label_plural = 'Intelligence Streams',
  description  = 'Sector and competitor news feeds tailored to your company profile.',
  default_icon = 'newspaper',
  default_colour = '#059669'
WHERE key = 'intelligence';

UPDATE public.application_types SET
  label_plural = 'Sales Proposals',
  description  = 'Draft and manage sales proposals drawing on your knowledge base',
  default_icon = 'file-signature',
  default_colour = '#0d9488'
WHERE key = 'sales_proposal';

UPDATE public.application_types SET
  label_plural = label || 's',
  description  = label
WHERE key IN ('product_guide', 'competitor_research', 'training_onboarding')
  AND label_plural IS NULL;

-- Post-check: verify the 3 currently-rendered types are fully backfilled.
DO $$
DECLARE
  v_unbackfilled int;
BEGIN
  SELECT count(*) INTO v_unbackfilled
  FROM public.application_types
  WHERE key IN ('procurement', 'intelligence', 'sales_proposal')
    AND (label_plural IS NULL OR description IS NULL
         OR default_icon IS NULL OR default_colour IS NULL);
  IF v_unbackfilled <> 0 THEN
    RAISE EXCEPTION
      'ID-21 backfill incomplete: % rows in render-set still NULL', v_unbackfilled;
  END IF;
END $$;

COMMIT;
