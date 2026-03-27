-- Migration: add content_text_hash generated column and find_exact_duplicates RPC.
--
-- The generated column computes MD5 of normalised content text, mirroring
-- the normaliseTextForHash() function in lib/dedup.ts:
--   1. lowercase
--   2. strip non-alphanumeric/non-whitespace chars (preserving underscores via \w)
--   3. collapse whitespace to single spaces
--   4. trim leading/trailing whitespace
--
-- PostgreSQL's \w in regexp matches [a-zA-Z0-9_], same as JavaScript's \w.

-- Generated column: automatically computed on INSERT/UPDATE, no write-path changes needed
ALTER TABLE public.content_items
ADD COLUMN content_text_hash text GENERATED ALWAYS AS (
  md5(
    trim(
      regexp_replace(
        regexp_replace(
          lower(trim(content)),
          '[^\w\s]', '', 'g'
        ),
        '\s+', ' ', 'g'
      )
    )
  )
) STORED;

-- Btree index for O(log n) exact-match lookups
CREATE INDEX idx_content_items_content_text_hash
ON public.content_items (content_text_hash)
WHERE content_text_hash IS NOT NULL;

-- RPC function for exact duplicate lookup
CREATE OR REPLACE FUNCTION public.find_exact_duplicates(
  p_content_hash text,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, title text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT ci.id, ci.title
  FROM content_items ci
  WHERE ci.content_text_hash = p_content_hash
    AND ci.archived_at IS NULL
    AND (p_exclude_id IS NULL OR ci.id <> p_exclude_id)
  LIMIT 10;
$$;

ALTER FUNCTION public.find_exact_duplicates(text, uuid) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.find_exact_duplicates(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.find_exact_duplicates(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_exact_duplicates(text, uuid) TO service_role;
