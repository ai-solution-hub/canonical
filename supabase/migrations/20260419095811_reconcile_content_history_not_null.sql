-- Reconcile content_history NOT NULL constraints dropped by the squash.
-- OLD production: title NOT NULL, content NOT NULL
-- NEW post-squash: both nullable
-- Pre-flight: 0 existing rows have null title or content on the new project.

ALTER TABLE public.content_history
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN content SET NOT NULL;
