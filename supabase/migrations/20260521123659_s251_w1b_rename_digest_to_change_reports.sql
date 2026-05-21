-- =============================================================================
-- S251 W1B — digest → change_reports terminology cleanup
-- =============================================================================
--
-- Scope: PLAN.md §4.5 T5 residual cleanup per Liam ratification S251 W1B.
-- (a) RENAME COLUMN change_reports.digest_type → frequency
-- (b) UPDATE notifications_type_check ('digest_ready' → 'change_report_ready')
-- (c) UPDATE notifications_entity_type_check ('digest' → 'change_report')
-- (d) DROP COLUMN change_reports.theme_clusters (paired with ThemeCluster TS removal)
--
-- 2 prod rows in change_reports (both digest_type='weekly'). 0 prod rows match
-- digest_ready / entity_type='digest'. Live-DB audit (S251 W1B scope-discovery)
-- confirms no triggers/views/PL/pgSQL functions reference the dropped/renamed
-- surface.
--
-- Apply: staging first (turayklvaunphgbgscat), smoke, then prod (rovrymhhffssilaftdwd).
-- =============================================================================

SET search_path = public, extensions;

-- (a) RENAME COLUMN
ALTER TABLE public.change_reports RENAME COLUMN digest_type TO frequency;

-- (b) notifications.type CHECK — drop + recreate with renamed enum value
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'governance_review_needed'::text,
    'governance_approve'::text,
    'governance_request_changes'::text,
    'governance_revert'::text,
    'quality_flag'::text,
    'change_report_ready'::text,
    'freshness_transition'::text,
    'coverage_alert'::text,
    'content_gap'::text,
    'owner_content_stale'::text,
    'owner_content_updated'::text,
    'owner_assignment'::text,
    'source_document_updated'::text,
    'date_expiry_approaching'::text,
    'review_overdue'::text
  ]));

UPDATE public.notifications SET type = 'change_report_ready' WHERE type = 'digest_ready';
-- 0 rows expected per live-DB audit

-- (c) notifications.entity_type CHECK — drop + recreate with renamed enum value
ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type = ANY (ARRAY[
    'content_item'::text,
    'change_report'::text,
    'template_requirement'::text,
    'domain'::text,
    'source_document'::text,
    'entity_mention'::text
  ]));

UPDATE public.notifications SET entity_type = 'change_report' WHERE entity_type = 'digest';
-- 0 rows expected per live-DB audit

-- (d) DROP COLUMN theme_clusters (paired with ThemeCluster type removal)
ALTER TABLE public.change_reports DROP COLUMN theme_clusters;
