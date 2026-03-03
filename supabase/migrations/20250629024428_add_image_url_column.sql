-- Add image support to ideas table
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Create index for ideas with images (for filtering)
CREATE INDEX IF NOT EXISTS idx_ideas_has_image ON ideas((image_url IS NOT NULL));
