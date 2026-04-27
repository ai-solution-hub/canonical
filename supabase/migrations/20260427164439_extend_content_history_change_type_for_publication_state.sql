-- Extend content_history.change_type CHECK enum with 'publication_state'
--
-- Required by §5.2 publication-lifecycle Phase 2 (T6 PATCH route handler):
-- spec §8.3 sample writes content_history rows with
-- change_type='publication_state' to record publication-status transitions.
-- Live CHECK array (per pg_get_constraintdef on rovrymhhffssilaftdwd) is
-- {create, edit, ai_update, import, merge, rollback, archive, delete,
-- metadata_change, owner_change} -- does not contain 'publication_state'.
-- Without this extension the T6 PATCH branch would silently fail CHECK
-- on every successful transition (per CLAUDE.md
-- feedback_check_constraint_app_enum_drift).
--
-- Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T6 pre-flight (lines 535-544,
--       570-579). "If CHECK enum present and 'publication_state' absent, ship
--       a separate tiny migration extending the CHECK enum BEFORE T6 lands."
-- Spec: docs/specs/publication-lifecycle-state-machine-spec.md §8.3.

ALTER TABLE public.content_history
  DROP CONSTRAINT IF EXISTS content_history_change_type_check;

ALTER TABLE public.content_history
  ADD CONSTRAINT content_history_change_type_check
  CHECK (
    (change_type)::text = ANY (
      ARRAY[
        'create'::text,
        'edit'::text,
        'ai_update'::text,
        'import'::text,
        'merge'::text,
        'rollback'::text,
        'archive'::text,
        'delete'::text,
        'metadata_change'::text,
        'owner_change'::text,
        'publication_state'::text
      ]
    )
  );
