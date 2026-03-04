-- Add version column to bid_responses
ALTER TABLE bid_responses
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Auto-increment version on each INSERT or UPDATE
CREATE OR REPLACE FUNCTION bid_response_auto_version()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only increment if response content actually changed
    IF NEW.response_text IS DISTINCT FROM OLD.response_text
       OR NEW.response_text_advanced IS DISTINCT FROM OLD.response_text_advanced
       OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      NEW.version := OLD.version + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present (idempotent re-run)
DROP TRIGGER IF EXISTS bid_response_set_version ON bid_responses;

CREATE TRIGGER bid_response_set_version
  BEFORE INSERT OR UPDATE ON bid_responses
  FOR EACH ROW
  EXECUTE FUNCTION bid_response_auto_version();
