#!/usr/bin/env python3
"""
Bid Worker -- Asynchronous document processing service.

Polls processing_queue for pending jobs and processes:
- tender_extract_docx: Extract questions from Word documents
- tender_extract_pdf_text: Extract text from PDFs via pdfplumber

Usage:
  PYTHONUNBUFFERED=1 python3 scripts/bid_worker.py

Environment:
  SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_ANON_KEY)
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


def get_supabase() -> Client:
    """Create and return a Supabase client using environment variables."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY"
    )
    if not url or not key:
        print(
            "Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set",
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
            supabase.from_("projects")
            .select("domain_metadata")
            .eq("id", bid_id)
            .single()
            .execute()
        )
        metadata = bid.data["domain_metadata"] or {}
        metadata["status"] = "questions_extracted"
        supabase.from_("projects").update(
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
                            "result": json.dumps(output) if output else None,
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
