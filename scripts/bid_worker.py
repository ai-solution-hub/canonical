#!/usr/bin/env python3
"""
Bid Worker -- Asynchronous document processing service.

Polls processing_queue for pending jobs and processes:
- template_fill: Fill Word templates with approved bid responses

Usage:
  PYTHONUNBUFFERED=1 python3 scripts/bid_worker.py

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_PUBLISHABLE_KEY)
"""

import argparse
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

from supabase import create_client, Client, ClientOptions

POLL_INTERVAL = 2  # seconds
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Per WP-S5.3 D-21 F-1: --env=prod flag asserts SUPABASE_URL contains
# the prod project ref before entering the polling loop. The ref is sourced
# from PROD_PROJECT_REF (env) — per-client and never committed (ID-68).
PROD_PROJECT_URL_FRAGMENT = os.environ.get("PROD_PROJECT_REF")

# Ensure scripts directory is on sys.path for local imports
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from fill_template import fill_template, _validate_completed_document


def get_supabase() -> Client:
    """Create and return a Supabase client using environment variables."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_PUBLISHABLE_KEY"
    )
    if not url or not key:
        print(
            "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
            file=sys.stderr,
        )
        sys.exit(1)
    # ID-115 (S8): route from_/rpc to the exposed `api` schema (public is
    # unexposed post-cutover). Storage is a separate API and is unaffected.
    return create_client(url, key, options=ClientOptions(schema="api"))


def fill_template_job(supabase: Client, payload: dict) -> dict:
    """Fill a Word template with approved bid responses."""
    template_id = payload["template_id"]
    project_id = payload["project_id"]
    storage_path = payload["storage_path"]
    field_mappings = payload["field_mappings"]

    file_data = supabase.storage.from_("templates").download(storage_path)

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
        tmp_in.write(file_data)
        input_path = tmp_in.name

    base, _ = os.path.splitext(input_path)
    output_path = f"{base}_completed.docx"

    try:
        result = fill_template(input_path, output_path, field_mappings)

        # Upload completed document
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        completed_path = f"{project_id}/{template_id}/completed_{timestamp}.docx"

        with open(output_path, "rb") as f:
            supabase.storage.from_("templates").upload(
                completed_path,
                f.read(),
                {"content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
            )

        file_size = os.path.getsize(output_path)

        # Validate completed document formatting
        format_warnings = _validate_completed_document(input_path, output_path)
        if format_warnings:
            result["format_warnings"] = format_warnings

        # Create completion record
        completion = supabase.from_("template_completions").insert({
            "template_id": template_id,
            "storage_path": completed_path,
            "fields_filled": result["fields_filled"],
            "fields_skipped": result["fields_skipped"],
            "fields_failed": result["fields_failed"],
            "file_size": file_size,
            "created_by": payload.get("user_id"),
        }).execute()

        # Update field fill_status
        for mapping in field_mappings:
            field_id = mapping.get("field_id")
            if field_id:
                status = "filled"
                error_msg = None
                for err in result["errors"]:
                    if (err.get("table_index") == mapping["table_index"]
                            and err.get("row_index") == mapping["row_index"]):
                        status = "failed"
                        error_msg = err["error"]
                        break

                # S246 WP2b T2 (P4): template_fields → form_template_fields.
                supabase.from_("form_template_fields").update({
                    "fill_status": status,
                    "fill_error": error_msg,
                }).eq("id", field_id).execute()

        # Update template status
        # S246 WP2b T2 (P4): templates → form_templates.
        supabase.from_("form_templates").update({
            "status": "completed",
        }).eq("id", template_id).execute()

        return {
            **result,
            "completion_id": completion.data[0]["id"] if completion.data else None,
            "storage_path": completed_path,
        }

    except Exception as e:
        # S246 WP2b T2 (P4): templates → form_templates.
        supabase.from_("form_templates").update({
            "status": "fill_failed",
        }).eq("id", template_id).execute()
        raise

    finally:
        os.unlink(input_path)
        if os.path.exists(output_path):
            os.unlink(output_path)


def process_job(supabase: Client, job: dict) -> dict:
    """Route a job to the appropriate handler based on job_type.

    Args:
        supabase: Supabase client
        job: Job record from processing_queue

    Returns:
        Dict with handler-specific output

    Raises:
        ValueError: If job_type is unrecognised
    """
    job_type = job["job_type"]
    payload = job["payload"]

    if job_type == "template_fill":
        return fill_template_job(supabase, payload)
    else:
        raise ValueError(f"Unknown job type: {job_type}")


def main():
    """Main polling loop. Claims and processes jobs from processing_queue."""
    parser = argparse.ArgumentParser(description="Bid document worker daemon")
    parser.add_argument(
        "--env",
        choices=["prod", "staging", "auto"],
        default="auto",
        help=(
            "With --env=prod, asserts SUPABASE_URL points at prod before "
            "entering the polling loop. --env=staging and --env=auto are "
            "non-asserting (trust env). Default 'auto'."
        ),
    )
    args = parser.parse_args()

    if args.env == "prod":
        if not PROD_PROJECT_URL_FRAGMENT:
            sys.exit(
                "--env=prod set but PROD_PROJECT_REF is unset — cannot assert "
                "the prod target. Set PROD_PROJECT_REF=<prod-project-ref> (the "
                "client prod DB you are targeting; never committed)."
            )
        url = os.environ.get("SUPABASE_URL", "")
        if PROD_PROJECT_URL_FRAGMENT not in url:
            sys.exit(
                f"--env=prod set but SUPABASE_URL does not contain "
                f"'{PROD_PROJECT_URL_FRAGMENT}'. Run with explicit override:\n"
                f"  SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> "
                f"python3 scripts/bid_worker.py"
            )

    supabase = get_supabase()
    print(
        f"Bid worker started. Polling every {POLL_INTERVAL}s...",
        file=sys.stderr,
    )

    while True:
        try:
            # Claim next pending job (atomic via RPC — uses FOR UPDATE SKIP LOCKED)
            result = supabase.rpc("claim_next_job", {}).execute()

            if result.data and len(result.data) > 0:
                job = result.data[0]
                job_id = job["id"]
                job_type = job["job_type"]
                print(f"Processing job {job_id} ({job_type})...", file=sys.stderr)

                try:
                    output = process_job(supabase, job)
                    supabase.from_("processing_queue").update(
                        {
                            "status": "completed",
                            "completed_at": datetime.now(timezone.utc).isoformat(),
                            "result": output if output else None,
                        }
                    ).eq("id", job_id).execute()
                    print(
                        f"Job {job_id} completed successfully",
                        file=sys.stderr,
                    )
                except Exception as e:
                    print(f"Job {job_id} failed: {e}", file=sys.stderr)
                    supabase.from_("processing_queue").update(
                        {
                            "status": "failed",
                            "error_message": str(e),
                        }
                    ).eq("id", job_id).execute()
            else:
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            print("\nShutting down worker...", file=sys.stderr)
            break
        except Exception as e:
            print(f"Worker error: {e}", file=sys.stderr)
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
