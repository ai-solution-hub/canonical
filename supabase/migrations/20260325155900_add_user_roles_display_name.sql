-- Add display_name column to user_roles
-- Prerequisite for Wave 0: needed by Reader/Editor P4, Quality/Gov P4, Workflows P2
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS display_name text;

-- Backfill from auth.users: extract the part before @, replace dots/underscores
-- with spaces, title case. Best-effort — users can update their display name later.
-- user_roles has no email column, so we join against auth.users.
UPDATE user_roles ur
SET display_name = initcap(
  replace(
    replace(
      split_part(au.email, '@', 1),
      '.', ' '
    ),
    '_', ' '
  )
)
FROM auth.users au
WHERE ur.user_id = au.id
  AND ur.display_name IS NULL
  AND au.email IS NOT NULL;
