# syntax=docker/dockerfile:1
# ============================================================================
# pipeline/ image — the DR-152 rebuilt unit (id-465).
#
# This image is ONLY the two flows (ingest, produce) on upstream cocoindex.
# It deliberately does NOT carry the old sidecar's payload: no torch/docling
# (embeddings are a LiteLLM API call), no LibreOffice (convert-on-upload is
# an app-side duty being re-decided), no mock LLM server (DR-152 — provider
# selection is per-stage LiteLLM config), no bid_worker (its own unit).
#
# Deploy-wave items deliberately NOT settled here (recorded on id-465):
#   - the trigger surface (old tree exposed server.py /walk; the rebuilt
#     flows run as `cocoindex update` invocations — how the app triggers a
#     walk post-cutover is a design decision for the deploy wave, DR-018);
#   - the DR-119 lock discipline (CI-generated linux-x86_64 requirements
#     lock installed --no-deps) — the pins below are top-level exact pins,
#     which is honest for a first image but not yet the full lock closure.
#
# Build: docker build -f pipeline/Dockerfile pipeline/
# Run:   compose/Coolify `command:` selects the flow, e.g.
#          cocoindex update /app/ingest/main.py
#          cocoindex update /app/produce/main.py
# ============================================================================

FROM python:3.13.13-slim AS runtime

# git: the producer's post-update bundle commit/push (DR-016 client-owned
# git repo). openssh-client: the push transport.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && git --version && ssh -V

# Top-level exact pins; extras give the exact upstream closure this unit
# uses: postgres (asyncpg+pgvector targets/source), litellm (extraction +
# LiteLLMEmbedder), entity-resolution-llm (faiss + instructor + litellm).
RUN pip install --no-cache-dir \
      "cocoindex[postgres,litellm,entity-resolution-llm]==1.0.18" \
      "ruamel.yaml==0.19.1" \
      "pydantic>=2,<3"

# uid/gid 1000 matches the existing /cocoindex-state volume ownership
# (carried from the old image's cnb-compatible user, S560).
RUN groupadd --gid 1000 pipeline \
  && useradd --uid 1000 --gid 1000 -m -s /bin/bash pipeline

WORKDIR /app
COPY ingest/ ingest/
COPY produce/ produce/

# Import guard (the S560 lesson, kept): importing both flow entry modules at
# build time resolves their FULL import closure, so a missing dependency
# reds the BUILD, never the deploy. Both modules are import-safe without
# env (env is read inside the lifespan, not at module level).
RUN python3 -m compileall -q /app \
  && python3 -c "import ingest.main, produce.main; print('entrypoint imports resolve')"

USER pipeline

# No ENTRYPOINT — compose/Coolify `command:` selects the flow wholesale.
CMD ["cocoindex", "ls", "ingest/main.py"]
