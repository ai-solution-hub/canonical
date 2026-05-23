"""Local-dev entrypoint: `python3 -m scripts.cocoindex_pipeline`.

Boots `KH_PIPELINE_APP` via `coco.start_blocking()` until SIGTERM. The
Cloud Run Service uses `server.py` instead (HTTP wrapper for the /health
probe); this file is preserved for local invocations that do not need it.

Reference: docs/specs/cocoindex-flow-scaffolding/TECH.md §P-2.
"""

from __future__ import annotations

import cocoindex as coco

# Import side-effect: registers KH_PIPELINE_APP with the cocoindex
# environment via the `coco.App(...)` constructor call in flow.py.
from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP as _KH_PIPELINE_APP  # noqa: F401

if __name__ == "__main__":
    coco.start_blocking()
