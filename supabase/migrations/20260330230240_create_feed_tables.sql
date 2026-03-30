-- ============================================================
-- feed_sources: RSS feed URLs and polling config per stream
-- ============================================================

CREATE TABLE feed_sources (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  url                       text NOT NULL,
  source_type               varchar NOT NULL DEFAULT 'rss'
                            CHECK (source_type IN ('rss', 'web', 'api')),
  polling_interval_minutes  int NOT NULL DEFAULT 30,
  last_polled_at            timestamptz,
  last_polled_status        varchar CHECK (last_polled_status IN ('success', 'error', 'timeout', 'not_modified')),
  last_polled_error         text,
  etag                      text,
  last_modified             text,
  consecutive_failures      int NOT NULL DEFAULT 0,
  article_count             int NOT NULL DEFAULT 0,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_feed_sources_workspace ON feed_sources(workspace_id);
CREATE INDEX idx_feed_sources_active ON feed_sources(workspace_id) WHERE is_active = true;

CREATE TRIGGER set_feed_sources_updated_at
  BEFORE UPDATE ON feed_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- feed_prompts: versioned filtering prompts per stream
-- ============================================================

CREATE TABLE feed_prompts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prompt_text           text NOT NULL,
  version               int NOT NULL,
  is_active             boolean NOT NULL DEFAULT false,
  change_notes          text,
  performance_snapshot  jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id),

  UNIQUE (workspace_id, version)
);

CREATE INDEX idx_feed_prompts_workspace ON feed_prompts(workspace_id);
CREATE INDEX idx_feed_prompts_active ON feed_prompts(workspace_id) WHERE is_active = true;

-- ============================================================
-- feed_articles: every ingested article (passed and filtered)
-- ============================================================

CREATE TABLE feed_articles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feed_source_id      uuid NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
  external_url        text NOT NULL,
  external_id         text,
  title               text NOT NULL,
  raw_content         text,
  ai_summary          text,
  relevance_score     numeric(4,3) CHECK (relevance_score >= 0 AND relevance_score <= 1),
  relevance_category  varchar CHECK (relevance_category IN ('high', 'medium', 'low', 'irrelevant')),
  relevance_reasoning text,
  matched_categories  text[],
  passed              boolean NOT NULL DEFAULT false,
  prompt_version_id   uuid REFERENCES feed_prompts(id),
  content_item_id     uuid REFERENCES content_items(id) ON DELETE SET NULL,
  published_at        timestamptz,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_articles_workspace ON feed_articles(workspace_id);
CREATE INDEX idx_feed_articles_source ON feed_articles(feed_source_id);
CREATE INDEX idx_feed_articles_passed ON feed_articles(workspace_id) WHERE passed = true;
CREATE INDEX idx_feed_articles_external_url ON feed_articles(external_url);
CREATE INDEX idx_feed_articles_external_id ON feed_articles(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_articles_dedup ON feed_articles(workspace_id, external_url);

CREATE TRIGGER set_feed_articles_updated_at
  BEFORE UPDATE ON feed_articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- feed_flags: false positive / false negative feedback
-- ============================================================

CREATE TABLE feed_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_article_id   uuid NOT NULL REFERENCES feed_articles(id) ON DELETE CASCADE,
  flag_type         varchar NOT NULL CHECK (flag_type IN ('false_positive', 'false_negative')),
  flagged_by        uuid NOT NULL REFERENCES auth.users(id),
  notes             text,
  resolved          boolean NOT NULL DEFAULT false,
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES auth.users(id),
  resolved_notes    text,
  resolution_type   varchar CHECK (resolution_type IN ('addressed', 'dismissed')),
  prompt_version_id uuid REFERENCES feed_prompts(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_flags_article ON feed_flags(feed_article_id);
CREATE INDEX idx_feed_flags_unresolved ON feed_flags(feed_article_id) WHERE resolved = false;

-- ============================================================
-- RLS for all feed tables
-- ============================================================

-- feed_sources
ALTER TABLE feed_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feed_sources"
  ON feed_sources FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin and editor can insert feed_sources"
  ON feed_sources FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin and editor can update feed_sources"
  ON feed_sources FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'editor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin can delete feed_sources"
  ON feed_sources FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

-- feed_prompts
ALTER TABLE feed_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feed_prompts"
  ON feed_prompts FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin can manage feed_prompts"
  ON feed_prompts FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update feed_prompts"
  ON feed_prompts FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete feed_prompts"
  ON feed_prompts FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

-- feed_articles
ALTER TABLE feed_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feed_articles"
  ON feed_articles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin and editor can insert feed_articles"
  ON feed_articles FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin and editor can update feed_articles"
  ON feed_articles FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'editor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin can delete feed_articles"
  ON feed_articles FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

-- feed_flags
ALTER TABLE feed_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feed_flags"
  ON feed_flags FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin and editor can insert feed_flags"
  ON feed_flags FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin and editor can update feed_flags"
  ON feed_flags FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'editor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin can delete feed_flags"
  ON feed_flags FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');
