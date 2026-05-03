-- scripts/scrub-staging-pii.sql
--
-- v2 minimal-scrub matrix - auth schema only.
-- Invoked by scripts/staging-mirror-and-scrub.ts post-pg_dump-restore.
-- See docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res2-staging-live-mirror-spec.md §4.3.
--
-- Args:
--   --set=staging_bcrypt='<bcrypt-hash>'  (referenced as :'staging_bcrypt' below)
--
-- Invocation example (per F-v2-1 - --set NOT --variable):
--   psql -h <host> -U postgres \
--     --single-transaction \
--     --set=staging_bcrypt="$STAGING_SHARED_PASSWORD_BCRYPT" \
--     --file scripts/scrub-staging-pii.sql
--
-- Exit semantics: psql --single-transaction; partial failure rolls back.
--
-- v2 explicitly does NOT scrub: free-text body columns, free-text meta
-- columns, JSONB-path scrubs of non-auth tables, embedding stale-mark,
-- storage-bucket blobs (per spec §1.4 / §4.3 / D-WP-CI.RES.2-6).
--
-- CRITICAL forward-defence (CLAUDE.md gotcha):
--   content_items.content_text_hash is GENERATED ALWAYS - any future
--   scope expansion that touches content_items MUST omit this column
--   from UPDATE statements. v2 does not UPDATE content_items at all.
--
-- Service-account exemption (D-WP-CI.RES.2-8): the pipeline service
-- account row (id = 'a0000000-0000-4000-8000-000000000001') is exempt
-- from ALL Pass 1 + Pass 2 mutations - "preserved verbatim" per spec
-- §4.3 step 2. Pipeline runs require this UUID's row intact.

BEGIN;

-- -----------------------------------------------------------------------
-- Step 1: TEMP TABLE - deterministic UUID-to-staging-email derivation
-- -----------------------------------------------------------------------
--
-- SHA-256 prefix on id::text per research/15 §3.2 + D-WP-CI.RES.2-8.
-- Same prod-UUID input -> same staging-email output across refreshes,
-- ensuring audit-trail UUID resolution stays stable.
--
-- pgcrypto provides digest('text', 'sha256') -> bytea; encode(..., 'hex')
-- -> text; substr(..., 1, 12) -> first 12 hex chars (~48 bits, ample for
-- ~10 prod users; collision risk negligible at production scale).
CREATE TEMP TABLE staging_name_map ON COMMIT DROP AS
SELECT
  id,
  'staging-' || substr(encode(digest(id::text, 'sha256'), 'hex'), 1, 12) AS sha256_prefix,
  'staging-' || substr(encode(digest(id::text, 'sha256'), 'hex'), 1, 12) || '@kb-staging.test' AS scrubbed_email
FROM auth.users;

-- -----------------------------------------------------------------------
-- Step 2: Pass 1 - auth.users direct-identifier scrub
-- -----------------------------------------------------------------------
--
-- Per spec §4.3 Pass 1. Service-account row excluded entirely (safer
-- interpretation per impl brief - "preserved verbatim" applies to all
-- Pass 1 mutations, not just password). Bcrypt hash referenced as
-- :'staging_bcrypt' (single-quoted form) per F-v2-1 fix - ensures
-- proper string-literal escaping of $-literals like $2b$12$....
UPDATE auth.users u
   SET email                    = m.scrubbed_email,
       phone                    = NULL,
       encrypted_password       = :'staging_bcrypt',
       last_sign_in_at          = NULL,
       recovery_token           = '',
       confirmation_token       = '',
       reauthentication_token   = ''
  FROM staging_name_map m
 WHERE u.id = m.id
   AND u.id != 'a0000000-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------
-- Step 3: Mirror parity check - public.user_profiles via trigger
-- -----------------------------------------------------------------------
--
-- The on_auth_user_updated AFTER UPDATE trigger (WP-G3.4 §4.5) fires
-- per row in Pass 1, mirroring email + full_name + updated_at into
-- public.user_profiles via handle_user_update(). Belt-and-braces
-- explicit re-sync below catches any rows where the trigger silently
-- no-op'd (e.g. profile row missing - "should not happen" per WP-G3.4
-- comment but defensive here).
--
-- Note: handle_user_update() reads NEW.raw_user_meta_data ->> 'full_name'
-- which is still the prod full_name at this point (Pass 2 scrubs
-- raw_user_meta_data AFTER this re-sync). The explicit UPDATE below
-- only re-syncs email; full_name re-sync happens implicitly via the
-- trigger that fires on the Pass 2 raw_user_meta_data UPDATE.
UPDATE public.user_profiles p
   SET email      = m.scrubbed_email,
       updated_at = now()
  FROM staging_name_map m
 WHERE p.id = m.id
   AND p.id != 'a0000000-0000-4000-8000-000000000001'
   AND p.email IS DISTINCT FROM m.scrubbed_email;

-- -----------------------------------------------------------------------
-- Step 4: Pass 2 - JSONB deep scrub (auth.users + auth.identities)
-- -----------------------------------------------------------------------
--
-- Per spec §4.3 Pass 2. JSONB key replacement uses jsonb_set for
-- existing-key replacement and the `-` operator for key removal.
-- Service-account exempt (consistent with Pass 1).
--
-- auth.users.raw_user_meta_data: replace full_name, remove avatar_url.
UPDATE auth.users u
   SET raw_user_meta_data = (
         CASE
           WHEN u.raw_user_meta_data ? 'full_name'
             THEN jsonb_set(u.raw_user_meta_data, '{full_name}', to_jsonb(m.sha256_prefix), false)
           ELSE u.raw_user_meta_data
         END
       ) - 'avatar_url'
  FROM staging_name_map m
 WHERE u.id = m.id
   AND u.id != 'a0000000-0000-4000-8000-000000000001'
   AND u.raw_user_meta_data IS NOT NULL;

-- auth.identities.identity_data: replace email + name keys, remove picture.
-- identity_data is jsonb NOT NULL per Supabase schema; user_id FK to
-- auth.users.id used to derive sha256_prefix.
UPDATE auth.identities i
   SET identity_data = (
         jsonb_set(
           jsonb_set(
             i.identity_data,
             '{email}',
             to_jsonb(m.scrubbed_email),
             false
           ),
           '{name}',
           to_jsonb(m.sha256_prefix),
           false
         )
       ) - 'picture'
  FROM staging_name_map m
 WHERE i.user_id = m.id
   AND i.user_id != 'a0000000-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------
-- Step 5: Pass 3 - auth-table TRUNCATE (session/token tables)
-- -----------------------------------------------------------------------
--
-- Per spec §4.3 Pass 3. Belt-and-braces against any leak through the
-- pg_dump (these tables are also excluded via --exclude-table-data in
-- step 7.3 of §2.7). RESTART IDENTITY resets any sequence on these
-- tables. Inside BEGIN/COMMIT - TRUNCATE is transactional in PostgreSQL
-- (per F-v2-4 confirmation - safe inside --single-transaction).
--
-- v6 added auth.mfa_amr_claims after first-dispatch surfaced TRUNCATE
-- auth.sessions failing with "cannot truncate a table referenced in a
-- foreign key constraint - mfa_amr_claims references sessions". The
-- claims table FKs to sessions; truncating sessions without it raises.
-- Listing them together truncates both atomically.
TRUNCATE
  auth.refresh_tokens,
  auth.sessions,
  auth.flow_state,
  auth.mfa_factors,
  auth.mfa_challenges,
  auth.mfa_amr_claims
RESTART IDENTITY;

COMMIT;
