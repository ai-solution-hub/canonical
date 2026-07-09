"""Local-dev entrypoint: `python3 -m scripts.cocoindex_pipeline`.

Boots the canonical pipeline by running `KH_PIPELINE_APP.update_blocking(
live=True)` until SIGTERM. The Coolify-deployed container uses `server.py`
instead (HTTP wrapper for the /health probe); this file is preserved for
local invocations that do not need it.

Boot wiring (ID-49.1): the entrypoint runs the App via
`KH_PIPELINE_APP.update_blocking(live=True)`, NOT the bare
`coco.start_blocking()`. `start_blocking()` only starts the default
environment and ENTERS its `@coco.lifespan` (provisioning the asyncpg pool
under `DB_CTX`); it does NOT run any registered App's `main_fn`. Booting via
`start_blocking()` alone would provision the DB pool but never execute
`app_main`, so `mount_table_target(DB_CTX, …)` never runs and the pipeline
silently does nothing. `update_blocking()` lazily starts the SAME
lifespan-bearing default environment (so `DB_CTX` is provided) AND runs
`app_main` on it; `live=True` arms cocoindex's continuous fs-watch loop.
(AppConfig.environment defaults to the same `_default_env` the lifespan
binds to — verified against installed cocoindex 1.0.3.)

O-Q8 idle-mode: with COCOINDEX_SOURCE_PATH unset/missing, `app_main` logs
and returns before any `mount_each`, so `update_blocking()` returns cleanly
(nothing to watch) — the process is free to exit.

Reference: docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-2 (line 374).
"""

from __future__ import annotations

# Importing flow.py brings KH_PIPELINE_APP into scope and, as a side-effect,
# registers the App + `@coco.lifespan kh_pipeline_lifespan` on cocoindex's
# default environment via the `coco.App(...)` constructor call in flow.py.
from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP

if __name__ == "__main__":
    KH_PIPELINE_APP.update_blocking(live=True)
