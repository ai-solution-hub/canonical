# syntax=docker/dockerfile:1
# ============================================================================
# cocoindex pipeline sidecar — THE one build recipe (id-416, DR-119, S560).
#
# Replaces Cloud Native Buildpacks (gcr.io/buildpacks/builder:google-22, a
# Cloud-Run-era inheritance for a workload with no Google Cloud anywhere) plus
# the two post-`pack` docker-build layers (apt bake + ID-413 opencv-headless
# enforcement) that existed only because buildpacks could not express them.
#
# Everything previously implicit is now a readable line:
#   - deps install is `--no-deps` from requirements.lock — the lock is the
#     COMPLETE linux-x86_64 closure (CI-generated: pipeline-lock.yml), so any
#     future lock gap is a build failure here, never a silent pip backfill.
#   - torch is CPU-only (+cpu wheels from download.pytorch.org/whl/cpu — the
#     extra index below). Nothing in this pipeline uses a GPU; the old image
#     shipped ~4.6 GB of CUDA/triton payload purely via pip's backfill.
#     The import guard asserts '+cpu' so a CUDA regression reds the build.
#   - the COPY set IS the deployed unit's boundary (read by id-443's
#     relocation): the cocoindex_pipeline package + the three sibling modules
#     form_extractors/docx.py imports. No tests, no fixtures — the nightly
#     stages corpus/templates from the CHECKOUT (bind-mount + POST /stage),
#     never from inside the image. Runtime snapshot readers were retired at
#     S537 (DR-130), so nothing under scripts/tests/ is imported in prod.
#
# Build (CI: .github/actions/build-cocoindex-image, called by
# onprem-deploy.yml [push sha-<sha> + moving :main] and by the nightly's
# branch-dispatch fallback):
#   docker buildx build -f deploy/docker/cocoindex.Dockerfile .
#
# Processes running off this image (compose `command:` overrides exec
# natively under plain Docker — the CNB-launcher indirection is gone):
#   - default CMD:  python3 -m scripts.cocoindex_pipeline.server
#   - bid worker:   python3 -m scripts.bid_worker
#   - mock LLM:     python3 -m scripts.cocoindex_pipeline.mock_llm  (staging/CI)
# ============================================================================

# --- builder: resolve nothing, install the lock verbatim ---------------------
# Same base as runtime so the venv transplants cleanly. build-essential is
# belt-and-braces for any sdist without a cp313 manylinux wheel; it stays out
# of the runtime image.
FROM python:3.13.13-slim AS builder
# pinned 2026-08-12 — matches the buildpack's GOOGLE_PYTHON_VERSION=3.13.13

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.lock /tmp/requirements.lock

# --no-deps is the payoff of id-416: pip installs EXACTLY the lock, no
# re-resolution over each package's own metadata. The extra index serves the
# torch/torchvision `+cpu` local-version wheels (not hosted on PyPI); every
# other pin resolves from PyPI as usual.
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --no-deps \
       --extra-index-url https://download.pytorch.org/whl/cpu \
       -r /tmp/requirements.lock

# --- runtime -----------------------------------------------------------------
FROM python:3.13.13-slim

# The exact post-`pack` apt set, unchanged in intent (id-416 Surfaces: NOT the
# package list): git + openssh-client (producer git_sync/publish, DR-055) and
# LibreOffice writer+calc (`soffice` legacy .doc/.xls convert-on-upload,
# DR-059 / ID-145 {145.31}). The version probes fail the build loudly if the
# slim base ever stops satisfying them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git openssh-client libreoffice-writer libreoffice-calc \
  && rm -rf /var/lib/apt/lists/* \
  && soffice --headless --version && ssh -V && git --version

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1

# uid/gid 1000 deliberately matches the CNB `cnb` user so files on the
# existing /cocoindex-state volumes keep their ownership across the cutover.
RUN groupadd --gid 1000 pipeline \
  && useradd --uid 1000 --gid 1000 -m -s /bin/bash pipeline

WORKDIR /workspace

# The deployed unit, explicitly. form_extractors/docx.py imports the three
# sibling modules (scripts.analyse_template, scripts.extract_tender_questions,
# scripts.docx_utils) — the measured, closed import set; nothing else under
# scripts/ is reachable from the three entrypoints. fixtures/ is excluded via
# deploy/docker/cocoindex.Dockerfile.dockerignore (staged from the checkout at
# run time, never read from the image).
COPY scripts/cocoindex_pipeline/ scripts/cocoindex_pipeline/
COPY scripts/bid_worker.py \
     scripts/analyse_template.py \
     scripts/extract_tender_questions.py \
     scripts/docx_utils.py \
     scripts/

# Closure + hygiene guard, replacing the ID-413 post-`pack` layer:
#  - torch imports AND is the +cpu build (the CUDA set never ships again);
#  - cv2 imports AND resolves to opencv-python-headless ONLY (the full
#    X11-linked variant broke every PDF convert — 69 drops in one nightly);
#  - docling imports (the heavy layout-model dependency chain is intact);
#  - the whole shipped tree byte-compiles (import-time syntax guard without
#    triggering module-level side effects that need live env/config).
RUN python3 -m compileall -q /workspace/scripts
RUN python3 - <<'PYCHECK'
import importlib.metadata as md
import cv2, docling, torch
assert "+cpu" in torch.__version__, f"expected a +cpu torch build, got {torch.__version__}"
names = {d.metadata["Name"] for d in md.distributions()}
assert "opencv-python" not in names, sorted(n for n in names if n and "opencv" in n)
print(f"guard OK: torch {torch.__version__}, cv2 {cv2.__version__} (headless only)")
PYCHECK

USER pipeline

# `-m` invocation is load-bearing (FX-8): WORKDIR lands /workspace on
# sys.path so `scripts.` qualified imports resolve. No ENTRYPOINT — compose
# `command:` overrides replace this CMD wholesale, plain-Docker semantics.
CMD ["python3", "-m", "scripts.cocoindex_pipeline.server"]
