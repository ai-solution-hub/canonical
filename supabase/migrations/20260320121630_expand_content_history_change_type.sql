-- Expand content_history change_type CHECK to include owner_change
-- Required by content owner assignment (WP4 Phase 1)
ALTER TABLE content_history
  DROP CONSTRAINT IF EXISTS content_history_change_type_check;

ALTER TABLE content_history
  ADD CONSTRAINT content_history_change_type_check CHECK (
    change_type::text = ANY (ARRAY[
      'create'::text,
      'edit'::text,
      'ai_update'::text,
      'import'::text,
      'merge'::text,
      'rollback'::text,
      'archive'::text,
      'delete'::text,
      'metadata_change'::text,
      'owner_change'::text
    ])
  );
