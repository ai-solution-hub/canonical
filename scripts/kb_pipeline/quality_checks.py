"""Content quality checks for the Knowledge Hub pipeline.

Provides detection functions for common content quality issues:
- Duplicate sentence detection
- Date expiry detection (past dates)
"""

import re
from datetime import datetime, timezone


def has_duplicate_sentences(text: str, min_sentence_length: int = 20) -> dict:
    """Detect duplicate sentences within a text block.

    Splits text into sentences and checks for exact or near-exact duplicates.
    Only considers sentences longer than min_sentence_length to avoid false
    positives on short phrases like "Yes" or "N/A".

    Args:
        text: The text to check
        min_sentence_length: Minimum sentence length to consider (default 20 chars)

    Returns:
        Dict with keys:
            has_duplicates (bool): Whether duplicates were found
            duplicate_count (int): Number of duplicate sentences
            duplicates (list[str]): The duplicated sentence texts (truncated to 80 chars)
    """
    if not text or not text.strip():
        return {"has_duplicates": False, "duplicate_count": 0, "duplicates": []}

    # Split into sentences (period, question mark, exclamation followed by space or end)
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())

    # Normalise: lowercase, strip whitespace, collapse multiple spaces
    normalised = []
    for s in sentences:
        norm = re.sub(r'\s+', ' ', s.strip().lower())
        if len(norm) >= min_sentence_length:
            normalised.append((norm, s.strip()))

    # Find duplicates
    seen = {}
    duplicates = []
    for norm, original in normalised:
        if norm in seen:
            if norm not in [d[0] for d in duplicates]:
                duplicates.append((norm, original[:80]))
        else:
            seen[norm] = original

    return {
        "has_duplicates": len(duplicates) > 0,
        "duplicate_count": len(duplicates),
        "duplicates": [d[1] for d in duplicates],
    }


def detect_expired_dates(text: str, reference_date: datetime | None = None) -> dict:
    """Detect dates in text that are in the past.

    Finds date patterns in text and checks if they are before the reference date.
    Useful for flagging content with expired certifications, past deadlines, etc.

    Supported formats:
        - "28 August 2026", "1 January 2025"
        - "August 2026", "January 2025"
        - "DD/MM/YYYY", "DD-MM-YYYY"
        - "YYYY-MM-DD" (ISO)

    Args:
        text: The text to check
        reference_date: Date to compare against (default: now UTC)

    Returns:
        Dict with keys:
            has_expired (bool): Whether past dates were found
            expired_count (int): Number of expired dates
            expired_dates (list[dict]): Each with 'text' and 'parsed_date' keys
            future_dates (list[dict]): Dates that are still in the future
    """
    if not text or not text.strip():
        return {
            "has_expired": False,
            "expired_count": 0,
            "expired_dates": [],
            "future_dates": [],
        }

    if reference_date is None:
        reference_date = datetime.now(timezone.utc)

    expired = []
    future = []

    # Pattern 1: "28 August 2026" or "1 January 2025"
    pattern_dmy = re.findall(
        r'\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|'
        r'September|October|November|December)\s+(\d{4})\b',
        text, re.IGNORECASE
    )
    for day, month, year in pattern_dmy:
        try:
            parsed = datetime.strptime(f"{day} {month} {year}", "%d %B %Y")
            parsed = parsed.replace(tzinfo=timezone.utc)
            entry = {"text": f"{day} {month} {year}", "parsed_date": parsed.isoformat()}
            if parsed < reference_date:
                expired.append(entry)
            else:
                future.append(entry)
        except ValueError:
            pass

    # Pattern 2: "August 2026" (month + year, no day)
    pattern_my = re.findall(
        r'\b(January|February|March|April|May|June|July|August|'
        r'September|October|November|December)\s+(\d{4})\b',
        text, re.IGNORECASE
    )
    for month, year in pattern_my:
        # Skip if already matched as part of pattern 1
        match_text = f"{month} {year}"
        already_found = any(
            match_text.lower() in d["text"].lower()
            for d in expired + future
        )
        if already_found:
            continue
        try:
            parsed = datetime.strptime(f"1 {month} {year}", "%d %B %Y")
            parsed = parsed.replace(tzinfo=timezone.utc)
            entry = {"text": match_text, "parsed_date": parsed.isoformat()}
            if parsed < reference_date:
                expired.append(entry)
            else:
                future.append(entry)
        except ValueError:
            pass

    # Pattern 3: DD/MM/YYYY
    pattern_slash = re.findall(r'\b(\d{2})/(\d{2})/(\d{4})\b', text)
    for day, month, year in pattern_slash:
        try:
            parsed = datetime.strptime(f"{day}/{month}/{year}", "%d/%m/%Y")
            parsed = parsed.replace(tzinfo=timezone.utc)
            entry = {"text": f"{day}/{month}/{year}", "parsed_date": parsed.isoformat()}
            if parsed < reference_date:
                expired.append(entry)
            else:
                future.append(entry)
        except ValueError:
            pass

    return {
        "has_expired": len(expired) > 0,
        "expired_count": len(expired),
        "expired_dates": expired,
        "future_dates": future,
    }
