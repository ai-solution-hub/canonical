-- Align staging and production auth.users indexes observed by schema parity.
-- These indexes already exist on staging; IF NOT EXISTS makes staging a no-op
-- while allowing production to converge through the migration path.

CREATE INDEX IF NOT EXISTS idx_users_created_at_desc
  ON auth.users USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON auth.users USING btree (email);

CREATE INDEX IF NOT EXISTS idx_users_last_sign_in_at_desc
  ON auth.users USING btree (last_sign_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_name
  ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text)))
  WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);
