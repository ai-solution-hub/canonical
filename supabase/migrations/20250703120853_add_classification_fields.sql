-- Migration: Add comprehensive classification fields to ideas table
-- Purpose: Support multi-dimensional content classification and metadata enrichment

-- Add classification fields to ideas table
ALTER TABLE ideas
ADD COLUMN IF NOT EXISTS content_type text DEFAULT 'quick-idea',
ADD COLUMN IF NOT EXISTS sub_categories text[],
ADD COLUMN IF NOT EXISTS business_relevance_score integer DEFAULT 0 CHECK (business_relevance_score >= 0 AND business_relevance_score <= 100),
ADD COLUMN IF NOT EXISTS classification_metadata jsonb,
ADD COLUMN IF NOT EXISTS entities jsonb,
ADD COLUMN IF NOT EXISTS sentiment jsonb;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_ideas_content_type ON ideas(content_type);
CREATE INDEX IF NOT EXISTS idx_ideas_business_relevance ON ideas(business_relevance_score);
CREATE INDEX IF NOT EXISTS idx_ideas_sub_categories ON ideas USING gin(sub_categories);
CREATE INDEX IF NOT EXISTS idx_ideas_entities ON ideas USING gin(entities);
CREATE INDEX IF NOT EXISTS idx_ideas_sentiment ON ideas USING gin(sentiment);

-- Create classification audit table for tracking classification history
CREATE TABLE IF NOT EXISTS classification_audit (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  idea_id uuid REFERENCES ideas(id) ON DELETE CASCADE,
  classification_version text NOT NULL,
  classification_result jsonb NOT NULL,
  classified_at timestamp with time zone DEFAULT now(),
  processing_time_ms integer,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Add indexes for audit table
CREATE INDEX IF NOT EXISTS idx_classification_audit_idea_id ON classification_audit(idea_id);
CREATE INDEX IF NOT EXISTS idx_classification_audit_user_id ON classification_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_classification_audit_classified_at ON classification_audit(classified_at);

-- Enable RLS on classification_audit table
ALTER TABLE classification_audit ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view their own classification history
CREATE POLICY "Users can view their classification history"
  ON classification_audit FOR SELECT
  USING (user_id = auth.uid());

-- RLS policy: Users can insert their own classification records
CREATE POLICY "Users can insert classification records"
  ON classification_audit FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Function to automatically log classification operations
CREATE OR REPLACE FUNCTION log_classification_operation()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if classification metadata has changed
  IF (OLD.classification_metadata IS DISTINCT FROM NEW.classification_metadata) THEN
    INSERT INTO classification_audit (
      idea_id,
      classification_version,
      classification_result,
      processing_time_ms,
      user_id
    ) VALUES (
      NEW.id,
      COALESCE((NEW.classification_metadata->>'classificationVersion')::text, '1.0.0'),
      jsonb_build_object(
        'contentType', NEW.content_type,
        'primaryCategory', NEW.category,
        'subCategories', NEW.sub_categories,
        'businessRelevanceScore', NEW.business_relevance_score,
        'confidence', COALESCE((NEW.classification_metadata->>'confidence')::numeric, 0),
        'metadata', NEW.classification_metadata
      ),
      COALESCE((NEW.classification_metadata->>'processingTime')::integer, 0),
      NEW.user_id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to log classification operations
DROP TRIGGER IF EXISTS log_classification_changes ON ideas;
CREATE TRIGGER log_classification_changes
  AFTER UPDATE ON ideas
  FOR EACH ROW
  EXECUTE FUNCTION log_classification_operation();

-- Add comments for documentation
COMMENT ON COLUMN ideas.content_type IS 'Type of content: linkedin-post, quick-idea, research-note, etc.';
COMMENT ON COLUMN ideas.sub_categories IS 'Array of subcategory classifications';
COMMENT ON COLUMN ideas.business_relevance_score IS 'Business relevance score from 0-100';
COMMENT ON COLUMN ideas.classification_metadata IS 'Metadata about the classification process';
COMMENT ON COLUMN ideas.entities IS 'Extracted entities: people, companies, technologies, etc.';
COMMENT ON COLUMN ideas.sentiment IS 'Sentiment analysis results';

COMMENT ON TABLE classification_audit IS 'Audit trail for idea classification operations';

-- Grant necessary permissions
GRANT ALL ON classification_audit TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
