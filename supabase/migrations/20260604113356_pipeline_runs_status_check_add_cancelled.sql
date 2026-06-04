-- pipeline_runs.status CHECK — add 'cancelled' (ID-76 cancellation-status fix)
--
-- CHANGE (ID-76): user-initiated cancellation now lands status='cancelled'
-- on the pipeline_runs row — ALWAYS, for both producers:
--
--   1. The pending-cancel path (app/api/jobs/[id]/cancel/route.ts): when a
--      *pending* job is cancelled its worker never runs, so its
--      pre-allocated pipeline_runs row would otherwise stay 'running' /
--      'in_progress' FOREVER and the upload-tab poller would spin
--      indefinitely (the pending-cancel orphan bug). The cancel route now
--      closes that row to 'cancelled'.
--   2. The cooperative-cancel path (lib/ingest/markdown-orchestrator.ts
--      finaliseRun + lib/queue/dispatch.ts batch_reclassify): a *processing*
--      job that stops mid-run now finalises its row as 'cancelled'.
--
-- This SUPERSEDES the §5.4.4 §10 D-8 shortcut, under which mid-batch
-- cancellation was recorded as 'completed_with_errors' (no dedicated enum
-- value, cancellation signalled only via error_message). 'cancelled' is now
-- a first-class terminal status: it is silent in Sentry (a user cancel is
-- not a degradation), and the upload-tab UI surfaces a distinct "cancelled
-- by user" toast.
--
-- The live CHECK constraint (after the S299 'in_progress' widening) is:
--
--   CHECK (status = ANY (ARRAY['running','in_progress','completed',
--                              'completed_with_errors','failed']))
--
-- This widens it to admit 'cancelled'. All five existing values are
-- RETAINED — this is purely additive.
--
-- No functions are introduced → no `SET search_path` clause needed.
-- Idempotent: DROP IF EXISTS before ADD.

ALTER TABLE public.pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;

ALTER TABLE public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
    CHECK (status = ANY (ARRAY[
      'running',
      'in_progress',
      'completed',
      'completed_with_errors',
      'failed',
      'cancelled'
    ]));
