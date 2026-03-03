"""Log pipeline execution to the pipeline_runs table in Supabase.

Usage from wrapper scripts:
    RUN_ID=$(python3 -c "from kb_pipeline.pipeline_log import start_run; print(start_run('bookmarklet'))")
    # ... run pipeline ...
    python3 -c "from kb_pipeline.pipeline_log import complete_run; complete_run('$RUN_ID', items_processed=$ITEMS)"

Usage from Python scripts:
    from kb_pipeline.pipeline_log import start_run, complete_run, fail_run
    run_id = start_run('gmail')
    try:
        count = do_work()
        complete_run(run_id, items_processed=count)
    except Exception as e:
        fail_run(run_id, str(e))
"""

import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

from .config import SUPABASE_URL, get_env


def _get_headers():
    env = get_env()
    key = env.get("SUPABASE_ANON_KEY", os.environ.get("SUPABASE_ANON_KEY", ""))
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _supabase_post(path: str, body: dict) -> dict | None:
    """POST to Supabase REST API. Returns first row or None."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_get_headers(), method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            return result[0] if isinstance(result, list) and result else result
    except urllib.error.HTTPError as e:
        print(f"[pipeline_log] POST {path} failed: {e.code} {e.read().decode()}", file=sys.stderr)
        return None


def _supabase_patch(path: str, body: dict) -> dict | None:
    """PATCH to Supabase REST API. Returns first row or None."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_get_headers(), method="PATCH")
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            return result[0] if isinstance(result, list) and result else result
    except urllib.error.HTTPError as e:
        print(f"[pipeline_log] PATCH {path} failed: {e.code} {e.read().decode()}", file=sys.stderr)
        return None


def start_run(pipeline_name: str) -> str | None:
    """Insert a new pipeline_runs row with status 'running'. Returns the run UUID."""
    row = _supabase_post("pipeline_runs", {
        "pipeline_name": pipeline_name,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
    })
    if row and "id" in row:
        return row["id"]
    return None


def complete_run(run_id: str, items_processed: int = 0, cost: float | None = None) -> None:
    """Mark a pipeline run as completed."""
    body: dict = {
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "items_processed": items_processed,
    }
    if cost is not None:
        body["cost"] = cost
    _supabase_patch(f"pipeline_runs?id=eq.{run_id}", body)


def fail_run(run_id: str, error_message: str = "") -> None:
    """Mark a pipeline run as failed."""
    _supabase_patch(f"pipeline_runs?id=eq.{run_id}", {
        "status": "failed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "error_message": error_message[:2000],  # truncate long errors
    })


# --- CLI interface for shell scripts ---
if __name__ == "__main__":
    """CLI: python3 -m kb_pipeline.pipeline_log <action> <args>

    Actions:
        start <pipeline_name>           → prints run_id
        complete <run_id> [items] [cost]
        fail <run_id> [error_message]
    """
    args = sys.argv[1:]
    if not args:
        print("Usage: python3 -m kb_pipeline.pipeline_log start|complete|fail <args>", file=sys.stderr)
        sys.exit(1)

    action = args[0]

    if action == "start" and len(args) >= 2:
        run_id = start_run(args[1])
        if run_id:
            print(run_id)
        else:
            sys.exit(1)

    elif action == "complete" and len(args) >= 2:
        items = int(args[2]) if len(args) > 2 else 0
        cost_val = float(args[3]) if len(args) > 3 else None
        complete_run(args[1], items_processed=items, cost=cost_val)

    elif action == "fail" and len(args) >= 2:
        err_msg = args[2] if len(args) > 2 else ""
        fail_run(args[1], err_msg)

    else:
        print(f"Unknown action: {action}", file=sys.stderr)
        sys.exit(1)
