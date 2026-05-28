# Cloud Run Services — cocoindex Sidecar

<!-- Last verified: 21/05/2026 -->

This directory contains Cloud Run **Service** manifests for the cocoindex sidecar
(`kh-cocoindex-pipeline`). The sidecar hosts the cocoindex Rust engine (LMDB-backed) and
Docling (MIT, 1.8 GB model weights) in a single container image.

---

## Service vs Job split rationale (S14 / O-Q2)

| Dimension       | Cloud Run Job (`cloudrun/jobs/`)  | Cloud Run Service (`cloudrun/services/`) |
| --------------- | --------------------------------- | ---------------------------------------- |
| **Lifecycle**   | Exits after each task invocation  | Runs continuously, accepts HTTP requests |
| **LMDB state**  | Cold-start LMDB rebuild every run | LMDB stays warm between calls            |
| **Use case**    | `kh-pipeline` ingestion job       | `kh-cocoindex-pipeline` sidecar engine   |
| **Scaling**     | taskCount per invocation          | min/max instances                        |
| **Concurrency** | N/A (single task)                 | `containerConcurrency: 10` (in-process)  |

**Rationale (S14 single-orchestrator topology / O-Q2):** The cocoindex Rust engine keeps
an LMDB index in-process across requests. A Cloud Run Job would rebuild the index from
scratch on every invocation (~7 s rebuild latency, plus lost in-memory state). A Service
retains the LMDB state warm between calls, which is critical for the incremental update
semantics that cocoindex is built around.

`min_instances: 1, max_instances: 1` enforces a single-orchestrator topology — no
concurrent LMDB writer collisions are possible. `containerConcurrency: 10` allows multiple
HTTP requests to be in-flight simultaneously; cocoindex serialises LMDB writes internally.

**pullmd AGPL boundary (O-Q3):** pullmd (Pandoc-based Markdown converter, AGPL licensed)
ships in a separately-deployed Service and is never bundled in this image. The
`kh-cocoindex-pipeline` image uses Docling (MIT) for document conversion. Calls to pullmd
are made via HTTP using the `PULLMD_SERVICE_URL` Secret Manager mount (consumed by
`scripts/cocoindex_pipeline/_pullmd_to_markdown.py`, authored by ID-28.7).

---

## Per-tenant Service Account mapping

| Manifest file                 | Service name                 | Project             | Service Account                                              |
| ----------------------------- | ---------------------------- | ------------------- | ------------------------------------------------------------ |
| `prod-example-client-cocoindex.yaml`    | `kh-cocoindex-pipeline-example-client` | `kh-prod-494815`    | `example-client-pipeline-sa@kh-prod-494815.iam.gserviceaccount.com`    |
| `staging-example-client-cocoindex.yaml` | `kh-cocoindex-pipeline-example-client` | `kh-staging-494815` | `example-client-pipeline-sa@kh-staging-494815.iam.gserviceaccount.com` |

The Service Accounts are **reused** from the existing per-tenant Job SAs (see
`cloudrun/jobs/{prod,staging}-{example-client,kpf}.yaml`). No new SAs need to be created. The
existing `roles/secretmanager.secretAccessor` grant (project scope, per
`docs/runbooks/cloud-run-phase-1-handover.md §3`) covers Secret Manager access for the
Service workloads.

---

## Smoke-verify commands

After deploying, verify each Service is running and healthy:

```bash
# Production
gcloud run services describe kh-cocoindex-pipeline-example-client \
  --region=europe-west2 \
  --project=kh-prod-494815 \
  --format='table(metadata.name,status.conditions[0].type,status.conditions[0].status)'

gcloud run services describe kh-cocoindex-pipeline-kpf \
  --region=europe-west2 \
  --project=kh-prod-494815 \
  --format='table(metadata.name,status.conditions[0].type,status.conditions[0].status)'

# Staging
gcloud run services describe kh-cocoindex-pipeline-example-client \
  --region=europe-west2 \
  --project=kh-staging-494815 \
  --format='table(metadata.name,status.conditions[0].type,status.conditions[0].status)'

gcloud run services describe kh-cocoindex-pipeline-kpf \
  --region=europe-west2 \
  --project=kh-staging-494815 \
  --format='table(metadata.name,status.conditions[0].type,status.conditions[0].status)'
```

Expected output: `Ready = True` condition for each Service.

Health probe endpoint (once the Service is running):

```bash
SERVICE_URL=$(gcloud run services describe kh-cocoindex-pipeline-example-client \
  --region=europe-west2 --project=kh-prod-494815 \
  --format='value(status.url)')
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "${SERVICE_URL}/health"
# Expected: HTTP 200
```

---

## Docling pre-warm vs runtime download trade-off

| Approach                       | Cold-start latency | Image size impact       | Build time impact      |
| ------------------------------ | ------------------ | ----------------------- | ---------------------- |
| **Pre-warm (current)**         | ~0 s model load    | +1.8 GB (~5.3 GB total) | +30-45 min first build |
| Runtime download (alternative) | ~7 s model load    | -1.8 GB (~3.5 GB)       | Build unchanged        |

**Decision: pre-warm.** The S14 `min_instances: 1` design keeps the Service permanently
warm between calls, so the +30-45 min Cloud Build cost is paid once at deploy, not on
every cold-start. The 1.8 GB image overhead is an acceptable trade for deterministic
sub-second model availability.

If the image-size budget (5.3 GB, T-OQ4) is consistently exceeded, consider switching to
runtime download by removing `cloudrun/cocoindex-prewarm.py` from the Cloud Build step and
accepting the ~7 s cold-start penalty on the infrequent Service restarts.

---

## IMAGE_SHA forensic correlation procedure (Inv-8)

`IMAGE_SHA` is injected into each Service as an env var at deploy time (value set to
`$GITHUB_SHA` by the Cloud Build substitution `_COMMIT_SHA`). This enables cross-reference
between a pipeline run's outcome and the exact image version that processed the documents.

**To identify which image version processed a specific pipeline run:**

1. Query `pipeline_runs.result -> 'extractor_version'` in Supabase:

```sql
SELECT
  id,
  started_at,
  result -> 'extractor_version' AS extractor_version,
  status
FROM pipeline_runs
WHERE id = '<run-uuid>'
  AND result -> 'extractor_version' IS NOT NULL;
```

2. Cross-reference the `extractor_version` value against the Cloud Run Service's current
   `IMAGE_SHA` env var:

```bash
gcloud run services describe kh-cocoindex-pipeline-example-client \
  --region=europe-west2 \
  --project=kh-prod-494815 \
  --format='value(spec.template.spec.containers[0].env[IMAGE_SHA])'
```

3. If the SHAs differ, the run was processed by an earlier image version. Use
   `gcloud artifacts docker images list` to locate the historical tag:

```bash
gcloud artifacts docker images list \
  europe-west2-docker.pkg.dev/kh-prod-494815/pipeline/kh-cocoindex-pipeline \
  --include-tags \
  --filter="tags:<sha-prefix>"
```

The `IMAGE_SHA` value in `pipeline_runs.result` is populated by
`scripts/cocoindex_pipeline/flow.py` (authored by ID-28.8) from the `IMAGE_SHA` env var.

---

## Deployment

Services are deployed by the `Deploy cocoindex Services` step in
`.github/workflows/cloud-run-deploy.yml`. The step runs automatically on push to `main`
(prod) or `production-readiness` (staging) when any of the following paths change:

- `cloudrun/services/**`
- `cloudrun/cloudbuild-cocoindex.yaml`
- `cloudrun/cocoindex-prewarm.py`

Manual deploy:

```bash
# Staging
gcloud run services replace cloudrun/services/staging-example-client-cocoindex.yaml \
  --region=europe-west2 --project=kh-staging-494815

# Production
gcloud run services replace cloudrun/services/prod-example-client-cocoindex.yaml \
  --region=europe-west2 --project=kh-prod-494815
```
