-- Migration: add_date_expiry_notification_types
-- Phase 2 of Date Extraction & Reminders spec
--
-- 1. Expand notifications_type_check to include 'date_expiry_approaching'
-- 2. Expand notifications_entity_type_check to include 'entity_mention'
--    (required for entity-level expiry notifications on certifications/registrations)

-- 1. Expand notification types
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'governance_review_needed'::text,
      'governance_approve'::text,
      'governance_request_changes'::text,
      'governance_revert'::text,
      'quality_flag'::text,
      'digest_ready'::text,
      'freshness_transition'::text,
      'coverage_alert'::text,
      'content_gap'::text,
      'owner_content_stale'::text,
      'owner_content_updated'::text,
      'owner_assignment'::text,
      'source_document_updated'::text,
      'date_expiry_approaching'::text
    ])
  );

-- 2. Expand entity type check to include entity_mention
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_entity_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_entity_type_check CHECK (
    entity_type = ANY (ARRAY[
      'content_item'::text,
      'digest'::text,
      'template_requirement'::text,
      'domain'::text,
      'source_document'::text,
      'entity_mention'::text
    ])
  );
