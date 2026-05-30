# Secrets migration mapping — GCP Secret Manager → Coolify per-app encrypted env

**Task:** ID-66.10 — Migrate secrets into Coolify per-app encrypted env (TECH change 3,
migration step 5).

**Purpose:** Runbook for the operator performing the one-time manual copy of runtime
secret values out of GCP Secret Manager into Coolify's per-app encrypted env. This
document contains **env-var names, which service needs them, the GCP Secret Manager secret
name, and the `gcloud` fetch command only. No secret values appear here.**

**Coolify dashboard:** `http://77.68.122.71:8000` (per {66.6} runbook).

**Reference:** `docs/specs/ID-66-onprem-pivot/TECH.md` §"3. Secrets migration" and
`.github/workflows/cloud-run-deploy.yml` lines 347–409.

---

## Secret set

### Base set — needed by the `cocoindex` service (and inherited by all pipeline jobs)

| env var                                | service   | GCP Secret Manager name                | fetch command                                                                         | notes                                                 |
| -------------------------------------- | --------- | -------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`                    | cocoindex | `ANTHROPIC_API_KEY`                    | `gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY`                    | LLM provider key                                      |
| `OPENAI_API_KEY`                       | cocoindex | `OPENAI_API_KEY`                       | `gcloud secrets versions access latest --secret=OPENAI_API_KEY`                       | Embeddings                                            |
| `SUPABASE_URL`                         | cocoindex | `SUPABASE_URL`                         | `gcloud secrets versions access latest --secret=SUPABASE_URL`                         | Supabase project URL                                  |
| `SUPABASE_PUBLISHABLE_KEY`             | cocoindex | `SUPABASE_PUBLISHABLE_KEY`             | `gcloud secrets versions access latest --secret=SUPABASE_PUBLISHABLE_KEY`             | Anon/publishable key                                  |
| `SUPABASE_SERVICE_ROLE_KEY`            | cocoindex | `SUPABASE_SERVICE_ROLE_KEY`            | `gcloud secrets versions access latest --secret=SUPABASE_SERVICE_ROLE_KEY`            | Service-role key — high privilege                     |
| `NEXT_PUBLIC_SUPABASE_URL`             | cocoindex | `NEXT_PUBLIC_SUPABASE_URL`             | `gcloud secrets versions access latest --secret=NEXT_PUBLIC_SUPABASE_URL`             | Client-facing Supabase URL                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | cocoindex | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `gcloud secrets versions access latest --secret=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client-facing anon key                                |
| `NEXT_PUBLIC_APP_URL`                  | cocoindex | `NEXT_PUBLIC_APP_URL`                  | `gcloud secrets versions access latest --secret=NEXT_PUBLIC_APP_URL`                  | Vercel app origin                                     |
| `CRON_SECRET`                          | cocoindex | `CRON_SECRET`                          | `gcloud secrets versions access latest --secret=CRON_SECRET`                          | Auth token for inbound `pipeline-runs/record` webhook |
| `SENTRY_AUTH_TOKEN`                    | cocoindex | `SENTRY_AUTH_TOKEN`                    | `gcloud secrets versions access latest --secret=SENTRY_AUTH_TOKEN`                    | Error reporting                                       |

### cocoindex-specific secrets

| env var                    | service   | GCP Secret Manager name    | fetch command                                                             | notes                                                                                                                                                                                                            |
| -------------------------- | --------- | -------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COCOINDEX_DB_DSN`         | cocoindex | `COCOINDEX_DB_DSN`         | `gcloud secrets versions access latest --secret=COCOINDEX_DB_DSN`         | **Boot-required.** Supabase pooler connection string (region-qualified `aws-<n>-<region>` form). Must be present before `/health` serves. This is the engine's asyncpg DSN — NOT the LMDB path (`COCOINDEX_DB`). |
| `PIPELINE_RUN_WEBHOOK_URL` | cocoindex | `PIPELINE_RUN_WEBHOOK_URL` | `gcloud secrets versions access latest --secret=PIPELINE_RUN_WEBHOOK_URL` | Set after {66.13} confirms the webhook repoint. The value is the Vercel app URL for `app/api/internal/pipeline-runs/record`. Read by `flow.py:_emit_pipeline_run_webhook`.                                       |
| `PULLMD_API_TOKEN`         | cocoindex | `PULLMD_API_TOKEN`         | `gcloud secrets versions access latest --secret=PULLMD_API_TOKEN`         | Bearer token sent by the cocoindex adapter to pullmd. Retained as defence-in-depth even over the host-local compose network (inv 11).                                                                            |

### pullmd service secrets

| env var                 | service | GCP Secret Manager name | fetch command                                                          | notes                                                                                                         |
| ----------------------- | ------- | ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PULLMD_ADMIN_EMAIL`    | pullmd  | `PULLMD_ADMIN_EMAIL`    | `gcloud secrets versions access latest --secret=PULLMD_ADMIN_EMAIL`    | Single-admin mode (`PULLMD_AUTH_MODE=single-admin`). Boot-required.                                           |
| `PULLMD_ADMIN_PASSWORD` | pullmd  | `PULLMD_ADMIN_PASSWORD` | `gcloud secrets versions access latest --secret=PULLMD_ADMIN_PASSWORD` | Single-admin password. Boot-required.                                                                         |
| `PULLMD_API_TOKEN`      | pullmd  | `PULLMD_API_TOKEN`      | `gcloud secrets versions access latest --secret=PULLMD_API_TOKEN`      | Same secret as the cocoindex entry above — the shared Bearer token. Paste into the pullmd app env separately. |

---

## Dropped — not migrated

The following GCP credentials are **eliminated by B1** and must NOT be pasted into
Coolify:

- **GCP deploy-SA JSON** (`kh-cocoindex-pipeline-deploy@…` service-account key) — B1
  eliminates `gcloud run` deploys entirely ({66.17}, TECH change 4). No deploy-SA JSON
  ever lands on the host (PRODUCT invariant 12).
- **WIF credentials** (`GCP_WIF_PROVIDER` / `GCP_DEPLOY_SA_EMAIL` GitHub vars) — retired
  with `cloud-run-deploy.yml`. These stay in the GitHub repo variables for reversibility
  (invariant 24) but are not needed on the Coolify host.

---

## `PULLMD_SERVICE_URL` — no longer a secret

`PULLMD_SERVICE_URL` is **not migrated as a secret**. In the B1 co-location compose,
cocoindex and pullmd share the same Docker network. The value becomes the non-sensitive
plain string `http://pullmd:3000` (the Docker compose service alias). This is an ordinary,
non-sensitive env var set directly in `deploy/onprem/docker-compose.yml` or in Coolify's
non-secret env section (TECH change 1 / PRODUCT invariant 11).

The existing GCP Secret Manager secret named `PULLMD_SERVICE_URL` can be left in place for
reversibility (the Cloud Run manifests still reference it) — it does not need to be
deleted.

---

## How to apply

### Prerequisites

- Coolify dashboard reachable at `http://77.68.122.71:8000` (verified in {66.6}).
- `gcloud` CLI authenticated with access to the `kh-prod-494815` project.
- The Coolify application(s) for `cocoindex` and `pullmd` must already be created via the
  Docker Compose build pack ({66.8}).

### Steps

1. **Open Coolify** → navigate to the relevant application (cocoindex or pullmd).
2. **Go to Environment Variables** for that application.
3. For each row in the secret table above: a. Run the fetch command in a terminal:
   `gcloud secrets versions access latest --secret=<NAME>` b. Copy the returned value. c.
   In Coolify, add a new env var: set the **key** to the env var name from the table;
   paste the value. d. Mark the var as **secret/encrypted** (Coolify hides the value after
   save — OQ-66-3).
4. Save and redeploy.

> **Important:** paste the value directly and immediately. Do not write it to a file, pipe
> it to a variable in a persistent shell, or commit it anywhere. The intent of this
> runbook is names + commands only — values flow operator-to-Coolify UI and nowhere else.

### Coolify API alternative

Coolify exposes a REST API (`http://77.68.122.71:8000/api/v1`) that accepts env-var create
calls. This is useful for scripted bulk-import. It requires a Coolify API token (generate
one in Coolify → Profile → API Tokens). The API approach is not implemented here — it is
noted as an option for B2 when Infisical or a more automated secret-sync workflow is
adopted (OQ-66-3, Infisical deferred to B2).

---

## GCP Secret Manager name confirmation

`gcloud secrets list --project=kh-prod-494815` (names only, no values) confirms the
following secret names exist as of 2026-05-31:

```
ANTHROPIC_API_KEY
COCOINDEX_DB_DSN
CRON_SECRET
FIRECRAWL_API_KEY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_CLIENT_ID
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_URL
OPENAI_API_KEY
PIPELINE_RUN_WEBHOOK_URL
PULLMD_ADMIN_EMAIL
PULLMD_ADMIN_PASSWORD
PULLMD_API_TOKEN
PULLMD_SERVICE_URL
SENTRY_AUTH_TOKEN
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
```

All 17 secret names required by this runbook are present in the list above.
(`FIRECRAWL_API_KEY` and `NEXT_PUBLIC_CLIENT_ID` are present in GCP SM but are not part of
the B1 migration set — they are not referenced by the cocoindex or pullmd services in
`cloud-run-deploy.yml:347–409`.)
