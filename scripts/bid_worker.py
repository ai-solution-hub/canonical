#!/usr/bin/env python3
"""
Bid Worker -- Asynchronous document processing service.

Polls processing_queue for pending jobs and processes:
- tender_extract_docx: Extract questions from Word documents
- tender_extract_pdf_text: Extract text from PDFs via pdfplumber
- template_analyse: Analyse Word templates to identify completable fields
- template_fill: Fill Word templates with approved bid responses

Usage:
  PYTHONUNBUFFERED=1 python3 scripts/bid_worker.py

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

from supabase import create_client, Client

POLL_INTERVAL = 2  # seconds
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Ensure scripts directory is on sys.path for local imports
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from analyse_template import analyse_template
from fill_template import fill_template, _validate_completed_document


def get_supabase() -> Client:
    """Create and return a Supabase client using environment variables."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY"
    )
    if not url or not key:
        print(
            "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
            file=sys.stderr,
        )
        sys.exit(1)
    return create_client(url, key)


def extract_docx_questions(supabase: Client, payload: dict) -> dict:
    """Extract questions from a DOCX tender document.

    Downloads the file from Supabase Storage, runs the extraction script,
    and inserts extracted questions into bid_questions.

    Args:
        supabase: Supabase client
        payload: Job payload with bid_id and storage_path

    Returns:
        Dict with questions_inserted and sections_found counts
    """
    bid_id = payload["bid_id"]
    storage_path = payload["storage_path"]

    # Download file from Supabase Storage
    file_data = supabase.storage.from_("tender-documents").download(storage_path)

    # Write to temp file
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(file_data)
        tmp_path = tmp.name

    try:
        # Run extraction script
        result = subprocess.run(
            [
                sys.executable,
                os.path.join(SCRIPT_DIR, "extract_tender_questions.py"),
                tmp_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            raise RuntimeError(f"Extraction failed: {result.stderr}")

        extraction = json.loads(result.stdout)

        # Insert questions into bid_questions
        questions_to_insert = []
        for section in extraction["sections"]:
            for question in section["questions"]:
                questions_to_insert.append(
                    {
                        "project_id": bid_id,
                        "section_name": section["section_name"],
                        "section_sequence": section["section_sequence"],
                        "question_sequence": question["question_sequence"],
                        "question_text": question["question_text"],
                        "word_limit": question.get("word_limit"),
                        "evaluation_weight": question.get("evaluation_weight"),
                    }
                )

        if questions_to_insert:
            supabase.from_("bid_questions").insert(questions_to_insert).execute()

        # Update bid status in domain_metadata
        bid = (
            supabase.from_("workspaces")
            .select("domain_metadata")
            .eq("id", bid_id)
            .single()
            .execute()
        )
        metadata = bid.data["domain_metadata"] or {}
        metadata["status"] = "questions_extracted"
        supabase.from_("workspaces").update(
            {
                "domain_metadata": metadata,
            }
        ).eq("id", bid_id).execute()

        return {
            "questions_inserted": len(questions_to_insert),
            "sections_found": extraction["total_sections"],
        }
    finally:
        os.unlink(tmp_path)


def extract_pdf_text(supabase: Client, payload: dict) -> dict:
    """Extract text from a PDF document using pdfplumber.

    Downloads the file from Supabase Storage, extracts text from each page,
    and returns the concatenated result.

    Args:
        supabase: Supabase client
        payload: Job payload with storage_path

    Returns:
        Dict with pages_extracted count and extracted text
    """
    storage_path = payload["storage_path"]

    # Download file from Supabase Storage
    file_data = supabase.storage.from_("tender-documents").download(storage_path)

    # Write to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(file_data)
        tmp_path = tmp.name

    try:
        import pdfplumber

        text_pages = []
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    text_pages.append(text)

        return {
            "pages_extracted": len(text_pages),
            "text": "\n\n".join(text_pages),
        }
    finally:
        os.unlink(tmp_path)


def analyse_template_job(supabase: Client, payload: dict) -> dict:
    """Analyse a Word template to identify completable fields."""
    template_id = payload["template_id"]
    project_id = payload["project_id"]
    storage_path = payload["storage_path"]

    file_data = supabase.storage.from_("templates").download(storage_path)

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(file_data)
        tmp_path = tmp.name

    try:
        result = analyse_template(tmp_path)

        # Insert fields into template_fields
        fields_to_insert = []
        for field in result["fields"]:
            fields_to_insert.append({
                "template_id": template_id,
                **field,
            })

        if fields_to_insert:
            supabase.from_("template_fields").insert(fields_to_insert).execute()

        # Upload structure.json
        structure_path = f"{project_id}/{template_id}/structure.json"
        structure_data = {
            "version": 1,
            "analysed_at": datetime.now(timezone.utc).isoformat(),
            **result,
        }
        structure_json = json.dumps(structure_data, indent=2, ensure_ascii=False)
        supabase.storage.from_("templates").upload(
            structure_path,
            structure_json.encode("utf-8"),
            {"content-type": "application/json"},
        )

        # Update template record
        supabase.from_("templates").update({
            "status": "analysed",
            "field_count": result["total_fields"],
            "structure_path": structure_path,
        }).eq("id", template_id).execute()

        return {
            "fields_found": result["total_fields"],
            "tables_scanned": result["table_count"],
            "warnings": result["warnings"],
        }

    except Exception as e:
        supabase.from_("templates").update({
            "status": "analysis_failed",
        }).eq("id", template_id).execute()
        raise

    finally:
        os.unlink(tmp_path)


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

                supabase.from_("template_fields").update({
                    "fill_status": status,
                    "fill_error": error_msg,
                }).eq("id", field_id).execute()

        # Update template status
        supabase.from_("templates").update({
            "status": "completed",
        }).eq("id", template_id).execute()

        return {
            **result,
            "completion_id": completion.data[0]["id"] if completion.data else None,
            "storage_path": completed_path,
        }

    except Exception as e:
        supabase.from_("templates").update({
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

    if job_type == "tender_extract_docx":
        return extract_docx_questions(supabase, payload)
    elif job_type == "tender_extract_pdf_text":
        return extract_pdf_text(supabase, payload)
    elif job_type == "template_analyse":
        return analyse_template_job(supabase, payload)
    elif job_type == "template_fill":
        return fill_template_job(supabase, payload)
    else:
        raise ValueError(f"Unknown job type: {job_type}")


def main():
    """Main polling loop. Claims and processes jobs from processing_queue."""
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
