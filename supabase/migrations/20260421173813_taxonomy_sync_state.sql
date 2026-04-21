-- P0-TX: taxonomy_sync_state singleton table
-- Spec: docs/specs/p0-tx-taxonomy-sync-spec.md §4.2
-- Stores current drift-detection state for taxonomy sync

CREATE TABLE taxonomy_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_sync_hash text NOT NULL DEFAULT '',
  last_sync_at timestamptz,
  synced_by text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enforce singleton (only one row ever exists)
CREATE UNIQUE INDEX idx_taxonomy_sync_state_singleton
  ON taxonomy_sync_state ((true));

-- Seed the initial row
INSERT INTO taxonomy_sync_state (last_sync_hash, synced_by)
VALUES ('', 'migration');

-- RLS: admin read/write only
ALTER TABLE taxonomy_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read taxonomy_sync_state"
  ON taxonomy_sync_state FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin write taxonomy_sync_state"
  ON taxonomy_sync_state FOR UPDATE
  USING (public.get_user_role() = 'admin');

-- Advisory lock function for concurrent sync serialisation (spec §5.4)
CREATE OR REPLACE FUNCTION acquire_taxonomy_sync_lock()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('taxonomy_sync'));
END;
$$;
