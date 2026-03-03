-- Rename ai-implementation-roi -> ai-implementation-practice
-- Broader scope: covers practical implementation for SMBs, workflow redesign,
-- change management, AND ROI measurement

-- Update primary_subtopic
UPDATE content_items
SET primary_subtopic = 'ai-implementation-practice',
    updated_at = NOW()
WHERE primary_subtopic = 'ai-implementation-roi';

-- Update secondary_subtopic
UPDATE content_items
SET secondary_subtopic = 'ai-implementation-practice',
    updated_at = NOW()
WHERE secondary_subtopic = 'ai-implementation-roi';

-- Same for ideas table (if any exist)
UPDATE ideas
SET primary_subtopic = 'ai-implementation-practice'
WHERE primary_subtopic = 'ai-implementation-roi';

UPDATE ideas
SET secondary_subtopic = 'ai-implementation-practice'
WHERE secondary_subtopic = 'ai-implementation-roi';
