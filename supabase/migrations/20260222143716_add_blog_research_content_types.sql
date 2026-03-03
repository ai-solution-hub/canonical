
-- Add 'blog' and 'research' to content_type CHECK constraint
ALTER TABLE content_items DROP CONSTRAINT content_items_valid_content_type;
ALTER TABLE content_items ADD CONSTRAINT content_items_valid_content_type CHECK (
  content_type IN (
    'post', 'article', 'blog', 'pdf', 'product-page', 'podcast', 'video',
    'comment', 'newsletter', 'bookmark', 'transcript', 'note', 'course',
    'research', 'other'
  )
);

-- Update column comment to reflect new types
COMMENT ON COLUMN content_items.content_type IS 'Format/nature of content: post, article, blog, pdf, product-page, podcast, video, comment, newsletter, bookmark, transcript, note, course, research, other';
