#!/usr/bin/env python3
"""
Bid Worker -- Asynchronous document processing service.

Polls processing_queue for pending jobs and processes:
- template_fill: Fill Word templates with approved bid responses
- analyse_form: Plane-1 (questions) + Plane-2 (fillable structure)
  extraction over one uploaded form artefact (ID-145 {145.13}, BI-20,
  TECH.md §3.1/§3.2/§3.3). This is the FOLDED analyse_form lane G8's
  deploy-manifest decision (below) recommends against a second
  long-running service — this same poller/process gains the new job
  type rather than a dedicated analyse_form daemon.

Usage:
  PYTHONUNBUFFERED=1 python3 -m scripts.bid_worker

  ID-145 {145.13} note: invocation switched from the bare-script form
  (`python3 scripts/bid_worker.py`) to module form (`-m`), run from the
  REPO ROOT — required once this file gained a package-qualified import
  (`scripts.cocoindex_pipeline.form_extractors`, below). Bare-script
  invocation only puts this file's OWN directory (`scripts/`) on
  `sys.path`, not the repo root, so `scripts.cocoindex_pipeline...`
  resolves under `-m` but 404s (`ModuleNotFoundError: No module named
  'scripts'`) under the old bare-script form — verified empirically at
  impl time. `-m` also mirrors the sibling cocoindex sidecar's own
  canonical invocation (`python3 -m scripts.cocoindex_pipeline.server`,
  `.github/workflows/onprem-deploy.yml`'s `GOOGLE_ENTRYPOINT`). No prior
  automated caller invoked the bare-script form (G8 — bid_worker.py was
  "a manually-run poller" in no deploy manifest before this Subtask), so
  this is a clean switch, not a breaking change to a live caller.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_PUBLISHABLE_KEY)
  NEXT_PUBLIC_APP_URL, PIPELINE_TRIGGER_SECRET (or CRON_SECRET fallback) --
    analyse_form's Plane-1 bridge call to
    app/api/internal/procurement/extract-questions/route.ts (see
    _extract_plane1_questions below).
"""

import argparse
import asyncio
import base64
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

import httpx
from supabase import create_client, Client, ClientOptions

from scripts.cocoindex_pipeline.form_extractors import extract_form_structure
from scripts.cocoindex_pipeline.form_extractors import (
    orchestrator as _form_orchestrator,
)
from scripts.cocoindex_pipeline.form_extractors.shared import FormExtractionError

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


# ── analyse_form (ID-145 {145.13}, BI-20) ────────────────────────────────────
#
# Format-routes one uploaded form artefact through BOTH extraction planes
# (TECH.md §3.1): Plane-1 (questions, {145.12}'s live Claude path) ->
# form_questions; Plane-2 (fillable structure, {145.10}/{145.11}) ->
# form_instance_fields. See the module docstring's Environment block for the
# Plane-1 bridge's required env vars.

TENDER_DOCUMENTS_BUCKET = "tender-documents"

# form_instances.mime_type CHECK is the 3-valued {docx,xlsx,pdf} full-MIME
# set (TECH.md §2 M3 keeps it unchanged) — this maps each to the storage-key
# extension {145.9}'s upload route already uses ({id}/document.{ext}).
_MIME_TO_EXT = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}

# Container magic-byte signatures — mirrors app/api/procurement/upload/
# route.ts's own validateMagicBytes. Needed here because {145.9}'s upload
# route DELIBERATELY sets mime_type to the TARGET (post-conversion) value
# even for a legacy .doc/.xls upload (its own header comment: "only the
# bytes at storage_path are overwritten with the real converted artefact
# before the OOXML extraction lane runs") — this worker is what performs
# that overwrite, so it must sniff the ACTUAL bytes to tell a genuine OOXML
# upload apart from a legacy one wearing an OOXML mime_type.
_PDF_MAGIC = b"%PDF"
_ZIP_MAGIC = b"PK\x03\x04"
_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def _sniff_container(raw_bytes: bytes) -> str:
    """Return 'pdf' | 'zip' | 'ole2' | 'unknown' from the artefact's first
    bytes (container-level sniff only — does not validate internal
    structure)."""
    if raw_bytes.startswith(_PDF_MAGIC):
        return "pdf"
    if raw_bytes.startswith(_ZIP_MAGIC):
        return "zip"
    if raw_bytes.startswith(_OLE2_MAGIC):
        return "ole2"
    return "unknown"


def _convert_legacy_office_to_ooxml(raw_bytes: bytes, target_ext: str) -> bytes:
    """DR-059 LibreOffice headless convert-on-upload: a legacy .doc/.xls
    (OLE2 container) artefact -> real OOXML bytes (.docx/.xlsx).

    Shells out to `soffice --headless --convert-to <ext>`, the standard
    LibreOffice headless conversion invocation. Raises RuntimeError on a
    non-zero exit or a missing output file — NEVER silently returns the
    unconverted input bytes (a caller that got legacy OLE2 bytes back
    believing them converted would feed them into python-docx/openpyxl and
    hit a confusing parse error several steps downstream instead of a clear
    one here).
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        legacy_ext = "doc" if target_ext == "docx" else "xls"
        input_path = os.path.join(tmp_dir, f"input.{legacy_ext}")
        with open(input_path, "wb") as f:
            f.write(raw_bytes)

        result = subprocess.run(
            [
                "soffice",
                "--headless",
                "--norestore",
                "--convert-to",
                target_ext,
                "--outdir",
                tmp_dir,
                input_path,
            ],
            capture_output=True,
            timeout=120,
        )
        output_path = os.path.join(tmp_dir, f"input.{target_ext}")
        if result.returncode != 0 or not os.path.exists(output_path):
            raise RuntimeError(
                f"LibreOffice conversion to {target_ext} failed "
                f"(exit={result.returncode}): "
                f"{result.stderr.decode('utf-8', errors='replace')[:500]}"
            )
        with open(output_path, "rb") as f:
            return f.read()


def _extract_plane1_questions(raw_bytes: bytes, form_format: str) -> list[dict]:
    """POST to the Plane-1 extraction bridge
    (app/api/internal/procurement/extract-questions/route.ts, {145.13}) and
    flatten its section/question tree into a flat list of question dicts.

    WHY AN HTTP BRIDGE (not a Python port): TECH.md §3.1 names Plane-1's
    mechanism as {145.12}'s "live Claude path"
    (lib/domains/procurement/ai/extract-questions.ts) — reused, not
    reimplemented in Python (reimplementing would reintroduce the "two
    homes for one fact" pattern ID-145 exists to eliminate, TECH.md §1.1).
    That route is session-gated (`getAuthorisedClient`); this worker has no
    browser session, so it calls the dedicated internal bridge instead,
    authenticated the SAME way the cocoindex sidecar already authenticates
    to `/api/internal/pipeline-runs/record` (ID-127.18, S436 D1 — mirrors
    `_emit_pipeline_run_webhook` in `scripts/cocoindex_pipeline/flow.py`):
    `PIPELINE_TRIGGER_SECRET` preferred, `CRON_SECRET` fallback.

    Raises RuntimeError (caught per-plane by the caller — a Plane-1 failure
    must not prevent Plane-2 from writing its own rows, Inv-17-style) when
    the URL/secret env vars are unset, the bridge returns a non-2xx status,
    or a transport error occurs.
    """
    url = os.environ.get("NEXT_PUBLIC_APP_URL")
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET") or os.environ.get(
        "CRON_SECRET"
    )
    if not url or not secret:
        raise RuntimeError(
            "NEXT_PUBLIC_APP_URL or PIPELINE_TRIGGER_SECRET/CRON_SECRET not "
            "set — cannot reach the Plane-1 extraction bridge"
        )

    response = httpx.post(
        f"{url.rstrip('/')}/api/internal/procurement/extract-questions",
        json={
            "format": form_format,
            "content_base64": base64.b64encode(raw_bytes).decode("ascii"),
        },
        headers={"Authorization": f"Bearer {secret}"},
        timeout=150.0,
    )
    response.raise_for_status()
    payload = response.json()

    questions: list[dict] = []
    for section in payload.get("sections", []):
        for question in section.get("questions", []):
            questions.append(
                {
                    "section_name": section["section_name"],
                    "section_sequence": section["section_sequence"],
                    "question_text": question["question_text"],
                    "question_sequence": question["question_sequence"],
                    "word_limit": question.get("word_limit"),
                    "evaluation_weight": question.get("evaluation_weight"),
                }
            )
    return questions


def _write_form_questions(
    supabase: Client,
    form_id: str,
    questions: list[dict],
    created_by: str | None,
) -> int:
    """Dedup + insert Plane-1 questions into form_questions.

    Mirrors [id]/questions/extract/route.ts's own dedup-by-
    question_text(lower/strip) + upsert(ignoreDuplicates) contract — the
    SAME idempotency posture for a re-run/retry of this job.
    """
    if not questions:
        return 0

    existing = (
        supabase.from_("form_questions")
        .select("question_text")
        .eq("form_instance_id", form_id)
        .execute()
    )
    existing_texts = {
        (row.get("question_text") or "").lower().strip()
        for row in (existing.data or [])
    }

    new_questions = [
        q for q in questions if q["question_text"].lower().strip() not in existing_texts
    ]
    if not new_questions:
        return 0

    inserts = [
        {
            "form_instance_id": form_id,
            "section_name": q["section_name"],
            "section_sequence": q["section_sequence"],
            "question_text": q["question_text"],
            "question_sequence": q["question_sequence"],
            "word_limit": q["word_limit"],
            "evaluation_weight": q["evaluation_weight"],
            "created_by": created_by,
        }
        for q in new_questions
    ]
    supabase.from_("form_questions").upsert(
        inserts,
        on_conflict="form_instance_id,question_text",
        ignore_duplicates=True,
    ).execute()
    return len(new_questions)


def _write_form_instance_fields(supabase: Client, form_id: str, fields: list) -> int:
    """Insert Plane-2 ExtractedField rows into form_instance_fields (coords
    + fill_status='pending' per BI-20). ``fields`` is a list of this
    package's ``ExtractedField`` Pydantic rows (docx/xlsx readers, or the
    PDF adapter's shape-adapted rows — same type either way)."""
    if not fields:
        return 0
    rows = [
        {
            "form_instance_id": form_id,
            "field_type": f.field_type,
            "table_index": f.table_index,
            "row_index": f.row_index,
            "col_index": f.col_index,
            "question_text": f.question_text,
            "section_name": f.section_name,
            "word_limit": f.word_limit,
            "placeholder_text": f.placeholder_text,
            "mapping_status": "unreviewed",
            "fill_status": f.fill_status,
            "sequence": f.sequence,
            "is_mandatory": f.is_mandatory,
            "reference_urls": f.reference_urls,
        }
        for f in fields
    ]
    supabase.from_("form_instance_fields").insert(rows).execute()
    return len(rows)


def analyse_form_job(supabase: Client, payload: dict) -> dict:
    """Route an analyse_form job's artefact through Plane-1 (questions) +
    Plane-2 (fillable structure) extraction (TECH.md §3.1, BI-20).

    FORMAT ROUTING (CHANGES item 2 of the {145.13} brief): PDF ->
    commonforms lane ({145.11}); .docx/.xlsx -> OOXML lane ({145.10}) via
    the orchestrator; .doc/.xls (detected by magic-byte sniff — see
    `_sniff_container`'s docstring for why mime_type alone cannot
    distinguish these) -> LibreOffice headless convert THEN the OOXML lane,
    overwriting `storage_path` with the real converted bytes (mime_type
    stays the already-target value — DR-059/{145.9}'s documented contract).

    Each plane's failure is caught independently (Inv-17-style: one
    extractor's failure must not prevent the other's rows from landing) —
    the job only raises (marking the processing_queue row 'failed', per
    `process_job`'s caller) when BOTH planes fail.

    ``payload`` shape: {145.9}'s upload route enqueues via
    `enqueueQueueJob()` (`lib/queue/enqueue.ts`), which wraps the caller's
    body in the FULL `QueueJobPayload` envelope
    (`lib/queue/envelope.ts` §3.1) — `{envelope_version, auth_context,
    body: {form_id}}` — verbatim into `processing_queue.payload`. This is
    a DIFFERENT shape from the legacy flat `template_fill` payload
    `fill_template_job` above reads (that job type predates the envelope
    spec and is enqueued by a different, non-enveloped producer) — do not
    conflate the two when touching this function.
    """
    body = payload.get("body") or {}
    form_id = body["form_id"]
    auth_context = payload.get("auth_context") or {}
    enqueued_by = auth_context.get("user_id")

    form_result = (
        supabase.from_("form_instances")
        .select("id, storage_path, mime_type")
        .eq("id", form_id)
        .single()
        .execute()
    )
    form = form_result.data
    ext = _MIME_TO_EXT.get(form["mime_type"])
    if ext is None:
        raise ValueError(
            f"analyse_form: unrecognised form_instances.mime_type "
            f"{form['mime_type']!r} for form {form_id}"
        )

    raw_bytes = supabase.storage.from_(TENDER_DOCUMENTS_BUCKET).download(
        form["storage_path"]
    )
    container = _sniff_container(raw_bytes)

    if ext == "pdf":
        if container != "pdf":
            raise ValueError(
                f"analyse_form: mime_type says pdf but storage bytes are "
                f"not a PDF (sniffed={container!r}) for form {form_id}"
            )
    elif container == "ole2":
        # Legacy .doc/.xls wearing the target docx/xlsx mime_type (DR-059) —
        # convert, then overwrite storage with the real OOXML bytes so the
        # artefact is genuinely OOXML from here on.
        raw_bytes = _convert_legacy_office_to_ooxml(raw_bytes, ext)
        supabase.storage.from_(TENDER_DOCUMENTS_BUCKET).upload(
            form["storage_path"],
            raw_bytes,
            {"content-type": form["mime_type"], "upsert": "true"},
        )
    elif container != "zip":
        raise ValueError(
            f"analyse_form: unexpected container {container!r} for "
            f"mime_type={form['mime_type']!r}, form {form_id}"
        )

    filename = f"document.{ext}"

    # ── Plane 2 (mechanical — fillable structure) ───────────────────────
    plane2_error: str | None = None
    plane2_count = 0
    fillable_pdf_bytes: bytes | None = None

    try:
        if ext == "pdf":
            if _form_orchestrator._detect_pdf_fields is None:
                raise FormExtractionError(
                    "pdf_dependencies_unavailable", filename
                )
            # Called ONCE directly (not via extract_form_structure) — this
            # worker needs BOTH the field rows AND fillable_pdf_bytes,
            # which extract_form_structure's ExtractedForm-only contract
            # does not carry (see orchestrator.py's PDF WIRING note).
            pdf_result = _form_orchestrator._detect_pdf_fields(raw_bytes, filename)
            fillable_pdf_bytes = pdf_result.fillable_pdf_bytes
            extracted_form = _form_orchestrator._pdf_result_to_extracted_form(
                pdf_result, filename
            )
        else:
            extracted_form = asyncio.run(extract_form_structure(raw_bytes, filename))
        if extracted_form is not None:
            plane2_count = _write_form_instance_fields(
                supabase, form_id, extracted_form.fields
            )
    except (FormExtractionError, _form_orchestrator.PdfFieldDetectionError) as exc:
        plane2_error = str(exc)

    if fillable_pdf_bytes is not None:
        # {145.15} (fill step) consumes this artefact's own AcroForm /Rect
        # entries as the fill-time geometry (form_instance_fields has no
        # bbox/page columns — the GEOMETRY-PERSISTENCE decision documented
        # on orchestrator._pdf_result_to_extracted_form).
        supabase.storage.from_(TENDER_DOCUMENTS_BUCKET).upload(
            f"{form_id}/fillable.pdf",
            fillable_pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )

    # ── Plane 1 (semantic — questions) ──────────────────────────────────
    plane1_error: str | None = None
    plane1_count = 0
    try:
        questions = _extract_plane1_questions(raw_bytes, ext)
        plane1_count = _write_form_questions(
            supabase, form_id, questions, enqueued_by
        )
    except Exception as exc:  # noqa: BLE001 - Plane-1 failure must not abort Plane-2's already-written rows
        plane1_error = str(exc)

    if plane1_error and plane2_error:
        supabase.from_("form_instances").update(
            {"processing_status": "analysis_failed"}
        ).eq("id", form_id).execute()
        raise RuntimeError(
            f"analyse_form failed both planes for form {form_id}: "
            f"plane1={plane1_error!r} plane2={plane2_error!r}"
        )

    supabase.from_("form_instances").update(
        {"processing_status": "analysed"}
    ).eq("id", form_id).execute()

    return {
        "form_id": form_id,
        "plane1_questions_inserted": plane1_count,
        "plane2_fields_inserted": plane2_count,
        "plane1_error": plane1_error,
        "plane2_error": plane2_error,
    }


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
    elif job_type == "analyse_form":
        return analyse_form_job(supabase, payload)
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
