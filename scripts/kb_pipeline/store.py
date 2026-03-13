"""Supabase storage operations — insert, update, query, quality logging."""

import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Optional, List

from .config import get_supabase_url, get_supabase_secret_key


def _headers(prefer: str = "return=representation"):
    """Build Supabase auth headers using service_role key (bypasses RLS)."""
    key = get_supabase_secret_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _request(method: str, path: str, data: dict = None,
             prefer: str = "return=representation") -> tuple[int, any]:
    """Make a Supabase REST API request."""
    url = f"{get_supabase_url()}/rest/v1/{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    headers = _headers(prefer)

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            response_body = resp.read().decode("utf-8")
            if response_body:
                return resp.status, json.loads(response_body)
            return resp.status, None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return e.code, body


def fetch_taxonomy():
    """Fetch active taxonomy domains and subtopics from Supabase."""
    domains_path = (
        "taxonomy_domains?is_active=eq.true&order=display_order.asc"
        "&select=id,name,description,display_order"
    )
    subtopics_path = (
        "taxonomy_subtopics?is_active=eq.true&order=display_order.asc"
        "&select=id,domain_id,name,description,display_order"
    )

    status_d, domains = _request("GET", domains_path)
    if status_d not in (200, 206):
        raise RuntimeError(f"Failed to fetch taxonomy domains: {status_d} {domains}")

    status_s, subtopics = _request("GET", subtopics_path)
    if status_s not in (200, 206):
        raise RuntimeError(f"Failed to fetch taxonomy subtopics: {status_s} {subtopics}")

    return domains, subtopics


def insert_content_item(record: dict) -> tuple[bool, str]:
    """Insert a content_item. Returns (success, id_or_error).

    Automatically adds 'product_description' to ai_keywords for product_description items.
    """
    # Auto-inject "product_description" keyword for product_description content type
    if record.get("content_type") == "product_description":
        keywords = record.get("ai_keywords") or []
        if "product_description" not in keywords:
            record["ai_keywords"] = keywords + ["product_description"]

    status, response = _request("POST", "content_items", record)
    if status in (200, 201):
        if isinstance(response, list) and response:
            return True, response[0].get("id", "")
        return True, ""
    return False, str(response)


def update_content_item(item_id: str, updates: dict) -> bool:
    """Update a content_item by ID."""
    path = f"content_items?id=eq.{item_id}"
    status, _ = _request("PATCH", path, updates, prefer="return=minimal")
    return status in (200, 204)


def merge_item_metadata(item_id: str, new_data: dict) -> bool:
    """Merge keys into content_items.metadata via RPC (JSONB ||).

    Does not overwrite existing keys — only adds/updates the provided ones.
    """
    url = f"{get_supabase_url()}/rest/v1/rpc/merge_item_metadata"
    body = json.dumps({"p_item_id": item_id, "p_new_data": new_data}).encode("utf-8")
    headers = _headers(prefer="return=minimal")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status in (200, 204)
    except urllib.error.HTTPError:
        return False


def check_url_exists(source_url: str) -> Optional[str]:
    """Check if a URL already exists in content_items. Returns ID if found."""
    if not source_url:
        return None

    key = get_supabase_secret_key()

    url = f"{get_supabase_url()}/rest/v1/content_items?source_url=eq.{urllib.parse.quote(source_url, safe='')}&select=id"
    req = urllib.request.Request(url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data:
                return data[0]["id"]
    except Exception:
        pass

    return None


def resolve_quality_issue(
    content_item_id: str,
    flag_type: str,
    notes: str = "",
) -> bool:
    """Mark a quality issue as resolved."""
    path = (
        f"ingestion_quality_log?content_item_id=eq.{content_item_id}"
        f"&flag_type=eq.{flag_type}&resolved=eq.false"
    )
    updates = {
        "resolved": True,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "resolved_by": "pipeline",
        "resolution_notes": notes,
    }
    status, _ = _request("PATCH", path, updates, prefer="return=minimal")
    return status in (200, 204)


def log_quality_issue(
    content_item_id: str,
    flag_type: str,
    severity: str = "warning",
    details: dict = None,
    source_url: str = "",
    batch_name: str = "",
) -> bool:
    """Log a quality issue to ingestion_quality_log."""
    record = {
        "content_item_id": content_item_id,
        "flag_type": flag_type,
        "severity": severity,
        "details": details or {},
        "source_url": source_url,
        "ingestion_batch": batch_name,
    }
    status, _ = _request("POST", "ingestion_quality_log", record, prefer="return=minimal")
    return status in (200, 201)


def fetch_records(
    filters: str = "",
    select: str = "id,title,content,content_type,platform",
    order: str = "created_at.asc",
    limit: int = 1000,
) -> List[dict]:
    """Fetch content_items with optional filters. Uses pagination."""
    key = get_supabase_secret_key()
    all_records = []
    page_size = 50
    offset = 0

    while True:
        url = f"{get_supabase_url()}/rest/v1/content_items?select={select}&order={order}"
        if filters:
            url += f"&{filters}"

        req = urllib.request.Request(url)
        req.add_header("apikey", key)
        req.add_header("Authorization", f"Bearer {key}")
        req.add_header("Prefer", "count=exact")
        req.add_header("Range", f"{offset}-{offset + page_size - 1}")

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                all_records.extend(data)

                if len(data) < page_size or len(all_records) >= limit:
                    break
                offset += page_size

        except urllib.error.HTTPError as e:
            import logging
            logging.getLogger(__name__).warning(
                "HTTP %s fetching content_items (offset=%d): %s",
                e.code, offset, e.reason,
            )
            break

    return all_records[:limit]
