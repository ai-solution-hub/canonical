-- ID-64.4 (S296) — remaining real-missing content_items FKs + form_templates.status_reason.
--
-- RESEARCH §4.1/§4.2. Every column below has 0 orphan rows on prod (verified S296), so each
-- ADD CONSTRAINT validates immediately. ON DELETE SET NULL throughout: a user/parent purge must
-- null the reference, never cascade-delete corpus content (matches the existing
-- content_items_superseded_by_fkey / content_items_source_bid_fkey precedent).
--
-- Deliberately EXCLUDED:
--   * op_id — cocoindex per-flow correlation text; there is NO operations table; the pipeline
--     test enforces presence not referential integrity (§4.2). Adding an FK would be unsatisfiable.
--   * content_items.source_document_id — the one FK written intra-flow (content_items +
--     source_documents in the SAME cocoindex run); it lands in a SEPARATE migration ({64.3})
--     authored AFTER the {66.16} content-half smoke proves the sd->ci write order, so its
--     DEFERRABLE-vs-NOT-VALID shape is chosen from live evidence rather than guesswork.
--   * q_a_pair_history.changed_by — already carries an FK (-> auth.users(id) ON DELETE SET NULL,
--     verified S296). Re-pointing it to user_profiles is cosmetic on a 0-row table; deferred.
--
-- form_templates.status_reason is added NULLABLE: forward-prep for the PRODUCT Inv-17
-- graceful-empty form-write reason token (not yet written by flow.py as of S296).

ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES public.content_items(id) ON DELETE SET NULL,
  ADD CONSTRAINT content_items_content_owner_id_fkey
    FOREIGN KEY (content_owner_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT content_items_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT content_items_verified_by_fkey
    FOREIGN KEY (verified_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT content_items_governance_reviewer_id_fkey
    FOREIGN KEY (governance_reviewer_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.form_templates
  ADD COLUMN IF NOT EXISTS status_reason text;
