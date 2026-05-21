"""Module entrypoint for the cocoindex pipeline package.

Enables: python3 -m scripts.cocoindex_pipeline

Used by the Cloud Run Service GOOGLE_ENTRYPOINT so the Service binary
is: python3 -m scripts.cocoindex_pipeline (per Subtask 28.6 manifest).

Boots KH_PIPELINE_APP via coco.start_blocking() which starts the default
cocoindex environment and then runs the live update loop until the process
is terminated (SIGTERM from Cloud Run scale-down or deployment replacement).

References:
  docs/specs/cocoindex-flow-scaffolding/TECH.md §P-2
  spike/cocoindex_s1/probe_managed_by_user.py — canonical boot pattern
"""

from __future__ import annotations

import cocoindex as coco

# Import registers KH_PIPELINE_APP with the cocoindex environment on
# module load. No explicit reference to it needed here — registration
# happens as a side-effect of the coco.App() constructor call in flow.py.
from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP as _KH_PIPELINE_APP  # noqa: F401

if __name__ == "__main__":
    # start_blocking() starts the default environment and runs the live
    # update loop synchronously. Blocks until SIGTERM or KeyboardInterrupt.
    # Cloud Run Service sends SIGTERM on scale-down; cocoindex drains
    # in-flight work before exit.
    coco.start_blocking()
