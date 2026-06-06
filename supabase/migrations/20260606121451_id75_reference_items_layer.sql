SET search_path = public, extensions;

-- 1. reference_items — peer Layer-5 class (O4/D4; PRODUCT BI-3/BI-7).
--    id is PIPELINE-MINTED uuid5('ri:'+normalised URL) — deliberately NO DEFAULT.
CREATE TABLE public.reference_items (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,                -- PullMD/Docling markdown: the canonical body of record
  summary text NULL,
  source_url text NOT NULL,          -- canonical normalised URL (join contract, BI-4)
  published_at timestamptz NULL,     -- original publication time; never ingest time (BI-3)
  primary_domain text NULL,
  primary_subtopic text NULL,
  layer text NULL,                   -- v1 constant 'research'; validated below
  embedding vector(1024) NULL,       -- whole-record embedding, BI-17 (no chunk table)
  source_document_id uuid NOT NULL
    REFERENCES public.source_documents(id) ON DELETE RESTRICT,  -- provenance chain integrity (BI-15)
  ingestion_source text NOT NULL
    CHECK (ingestion_source IN ('rss_feed','url_import')),      -- CV 13 semantics, BI-9 / §6.3
  op_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reference_items_source_url_key UNIQUE (source_url) -- one reference per URL (BI-2/BI-8)
);
-- NO workspace FK. NO junction table. RATIFIED-DO-NOT-BUILD (BI-7; 32-q-a-pair.md §6 mirror).

CREATE INDEX idx_reference_items_embedding ON public.reference_items
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_reference_items_published_at ON public.reference_items (published_at DESC);
CREATE INDEX idx_reference_items_source_document_id ON public.reference_items (source_document_id);

CREATE TRIGGER set_reference_items_updated_at BEFORE UPDATE ON public.reference_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_validate_reference_items_layer
  BEFORE INSERT OR UPDATE OF layer ON public.reference_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_layer_key();

-- RLS: corpus-level read for all authenticated roles; NO app-side write policies —
-- writes are pipeline-only via the asyncpg owner connection (BI-16).
ALTER TABLE public.reference_items ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.reference_items'::regclass);
-- anon SELECT and authenticated CRUD grants above are overridden by RLS; the policy
-- below is the effective gate (q_a_pair_history precedent).
CREATE POLICY reference_items_select ON public.reference_items
  FOR SELECT TO authenticated USING (true);
-- (no INSERT/UPDATE/DELETE policies — q_a_pair_history precedent)

-- 2. feed_articles promotion FK re-point (BI-10) — mirrors the content_item_id idiom.
ALTER TABLE public.feed_articles ADD COLUMN IF NOT EXISTS reference_item_id uuid NULL
  REFERENCES public.reference_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_feed_articles_reference_item_id
  ON public.feed_articles (reference_item_id) WHERE reference_item_id IS NOT NULL;

-- 3. source_documents provenance hardening (BI-4; RESEARCH constraint 1 ratified).
ALTER TABLE public.source_documents ADD COLUMN IF NOT EXISTS source_url text NULL;
CREATE INDEX IF NOT EXISTS idx_source_documents_source_url
  ON public.source_documents (source_url) WHERE source_url IS NOT NULL;

-- 4. BI-21 operator surface: extend the quality-log flag_type enum (D-9).
ALTER TABLE public.ingestion_quality_log DROP CONSTRAINT IF EXISTS ingestion_quality_log_flag_type_check;
ALTER TABLE public.ingestion_quality_log ADD CONSTRAINT ingestion_quality_log_flag_type_check
  CHECK (flag_type = ANY (ARRAY['duplicate','low_quality','missing_field','review_needed',
                                'stale','conflicting','ssrf_rejected']));

COMMENT ON TABLE public.reference_items IS
  'Global, workspace-less external reference/evidence layer (ID-75, O4/D4). One row per normalised URL. Never auto-promotes into content_items.';
