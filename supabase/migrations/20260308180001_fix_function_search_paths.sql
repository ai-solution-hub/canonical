-- Fix "Function Search Path Mutable" security warning for 17 public functions.
-- Setting an explicit search_path prevents search-path hijacking attacks where
-- a malicious schema placed earlier in the path could shadow expected objects.

-- Temporarily set search_path so the 'vector' type (pgvector) resolves during ALTER.
SET search_path TO public, extensions;

ALTER FUNCTION public.bid_response_auto_version() SET search_path = 'public';
ALTER FUNCTION public.check_content_exists(ids uuid[]) SET search_path = 'public';
ALTER FUNCTION public.delete_tag(p_tag text, p_type text) SET search_path = 'public';
ALTER FUNCTION public.get_all_tag_counts() SET search_path = 'public';
ALTER FUNCTION public.get_bid_summary(bid_workspace_id uuid) SET search_path = 'public';
ALTER FUNCTION public.get_coverage_matrix(p_layer text) SET search_path = 'public';
ALTER FUNCTION public.get_coverage_summary() SET search_path = 'public';
ALTER FUNCTION public.get_item_workspaces(p_item_id uuid) SET search_path = 'public';
ALTER FUNCTION public.get_topic_layers(p_topic_id text) SET search_path = 'public';
ALTER FUNCTION public.get_workspace_counts() SET search_path = 'public';
ALTER FUNCTION public.get_workspace_item_counts() SET search_path = 'public';
ALTER FUNCTION public.hybrid_search(query_embedding vector, query_text text, similarity_threshold double precision, limit_count integer) SET search_path = 'public';
ALTER FUNCTION public.merge_tags(p_source text, p_target text, p_type text) SET search_path = 'public';
ALTER FUNCTION public.rename_tag(p_old text, p_new text, p_type text) SET search_path = 'public';
ALTER FUNCTION public.search_for_bid_response(query_embedding vector, query_text text, limit_count integer) SET search_path = 'public';
ALTER FUNCTION public.suggest_tags(p_prefix text, p_type text) SET search_path = 'public';
ALTER FUNCTION public.sync_bid_status_to_jsonb() SET search_path = 'public';
