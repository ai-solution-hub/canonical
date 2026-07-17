-- bl-496 (folded into id-142): form_instances.ingest_source DEFAULT 'pipeline'
-- violated the W1c-narrowed CHECK ('app_upload','minted'). All inserters pass
-- ingest_source explicitly; column stays NOT NULL so an omitting INSERT now
-- fails fail-loud on NOT NULL rather than silently on the CHECK.
-- DR-081: authored-not-applied this session; stamp is PROVISIONAL — re-verify
-- against the remote schema_migrations max and re-stamp at owner-gated apply time.
ALTER TABLE "public"."form_instances" ALTER COLUMN "ingest_source" DROP DEFAULT;
