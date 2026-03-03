-- Add sharing columns to the digests table
ALTER TABLE digests ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS share_branding JSONB;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS share_item_urls JSONB;

-- Index for fast token lookup on the public endpoint
CREATE INDEX IF NOT EXISTS idx_digests_share_token ON digests(share_token)
  WHERE share_token IS NOT NULL;

-- RLS policy: allow anonymous SELECT on digests with a valid, non-expired share token.
-- This is the ONLY anonymous access path. All other operations remain authenticated-only.
CREATE POLICY "public_read_shared_digests" ON digests
  FOR SELECT TO anon
  USING (
    share_token IS NOT NULL
    AND (share_expires_at IS NULL OR share_expires_at > NOW())
  );
