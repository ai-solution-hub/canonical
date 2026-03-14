-- M-17: Lightweight RPC for audit_content that returns char_length(content)
-- instead of the full content body. Avoids transferring megabytes of text
-- when only the character count is needed for threshold checks.

CREATE OR REPLACE FUNCTION get_audit_content_items(
  p_domain text DEFAULT NULL,
  p_limit int DEFAULT 500
)
RETURNS TABLE (
  id uuid,
  title text,
  suggested_title text,
  content_type text,
  primary_domain text,
  content_length int,
  ai_summary text,
  ai_keywords text[],
  classification_confidence double precision,
  freshness text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ci.id,
    ci.title,
    ci.suggested_title,
    ci.content_type,
    ci.primary_domain,
    COALESCE(char_length(ci.content), 0)::int AS content_length,
    ci.ai_summary,
    ci.ai_keywords,
    ci.classification_confidence,
    ci.freshness
  FROM content_items ci
  WHERE ci.archived_at IS NULL
    AND (p_domain IS NULL OR ci.primary_domain = p_domain)
  ORDER BY ci.updated_at DESC
  LIMIT p_limit;
$$;
