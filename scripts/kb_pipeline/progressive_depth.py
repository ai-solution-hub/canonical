"""Progressive-depth column generation for Q&A content items.

Populates `brief`, `detail`, and `reference` columns on content_items rows
of type `q_a_pair`. These columns feed the completeness dimension of the
quality score (lib/quality/quality-score.ts:completenessRaw).

Two strategies:

1. **AI generation** (primary) — uses claude-haiku-4-5 to structure
   the Q&A answer into brief/detail/reference layers. Cheap (~£0.003/call).
2. **Deterministic fallback** — pure Python extraction from existing fields.
   Used when AI generation fails or is unavailable (no API key, network
   error, malformed response).

Deterministic fallback logic:
    - `brief`     = first paragraph of answer_standard
    - `detail`    = answer_standard + answer_advanced concatenated
    - `reference` = question_text (the original question serves as the
                    reference anchor for progressive-depth navigation)

Usage from post_insert.py:
    >>> from kb_pipeline.progressive_depth import generate_progressive_depth
    >>> result = generate_progressive_depth(
    ...     question_text="What is ISO 27001?",
    ...     answer_standard="ISO 27001 is an international standard...",
    ...     answer_advanced="The certification process involves...",
    ... )
    >>> if result is not None:
    ...     update_content_item(item_id, result)
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Model for progressive-depth generation — cheap + fast.
PROGRESSIVE_DEPTH_MODEL = "claude-haiku-4-5"
PROGRESSIVE_DEPTH_MAX_TOKENS = 800

SYSTEM_PROMPT = """\
You are a technical writer structuring Q&A content for multi-layer \
presentation in a knowledge base. Given a question-and-answer pair, \
produce three progressive-depth fields:

1. **brief** (~60-120 words, 1 paragraph): The key point of the answer \
distilled into a single concise paragraph. No preamble.
2. **detail** (full structured answer): The complete answer combining \
standard and advanced content. Use clear paragraph breaks. Preserve \
technical accuracy. Do not invent information beyond what is provided.
3. **reference** (reference anchors): The original question text followed \
by any standards, certifications, frameworks, or regulations explicitly \
mentioned in the answer (e.g. ISO 27001, Cyber Essentials, GDPR). \
Separate each with a newline.

Return ONLY valid JSON with exactly three keys: "brief", "detail", \
"reference". No markdown fencing. UK English throughout."""


def _extract_first_paragraph(text: str) -> str:
    """Extract the first non-empty paragraph from text."""
    if not text:
        return ""
    paragraphs = text.strip().split("\n\n")
    for para in paragraphs:
        stripped = para.strip()
        if stripped:
            return stripped
    # Fallback: return the whole text if no paragraph break found
    return text.strip()


def deterministic_fallback(
    question_text: str,
    answer_standard: str | None,
    answer_advanced: str | None,
) -> dict[str, str] | None:
    """Generate progressive-depth columns deterministically from answer fields.

    Returns None if answer_standard is empty/None (nothing to derive from).
    Otherwise returns {"brief": ..., "detail": ..., "reference": ...}.
    """
    if not answer_standard or not answer_standard.strip():
        return None

    brief = _extract_first_paragraph(answer_standard)

    # detail = full answer_standard + answer_advanced concatenated
    detail_parts = [answer_standard.strip()]
    if answer_advanced and answer_advanced.strip():
        detail_parts.append(answer_advanced.strip())
    detail = "\n\n".join(detail_parts)

    # reference = the question text (serves as the reference anchor)
    reference = question_text.strip() if question_text else ""

    if not reference:
        return None

    return {
        "brief": brief,
        "detail": detail,
        "reference": reference,
    }


def _build_user_prompt(
    question_text: str,
    answer_standard: str | None,
    answer_advanced: str | None,
) -> str:
    """Build the user message for the AI generation call."""
    parts = [f"Question: {question_text}"]
    if answer_standard:
        parts.append(f"\nStandard Answer:\n{answer_standard}")
    if answer_advanced:
        parts.append(f"\nAdvanced Answer:\n{answer_advanced}")
    return "\n".join(parts)


def _parse_ai_response(text: str) -> dict[str, str] | None:
    """Parse the AI response JSON into a dict with brief/detail/reference.

    Returns None if parsing fails or required keys are missing.
    """
    try:
        # Strip any markdown fencing the model might have added
        cleaned = text.strip()
        if cleaned.startswith("```"):
            # Remove opening fence (with optional language tag)
            first_newline = cleaned.index("\n")
            cleaned = cleaned[first_newline + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()

        data = json.loads(cleaned)
        if not isinstance(data, dict):
            return None

        brief = data.get("brief", "")
        detail = data.get("detail", "")
        reference = data.get("reference", "")

        if not brief or not detail or not reference:
            return None

        return {
            "brief": str(brief).strip(),
            "detail": str(detail).strip(),
            "reference": str(reference).strip(),
        }
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Failed to parse AI progressive-depth response: %s", e)
        return None


def generate_progressive_depth_ai(
    question_text: str,
    answer_standard: str | None,
    answer_advanced: str | None,
) -> dict[str, str] | None:
    """Generate progressive-depth columns via AI (claude-haiku-4-5).

    Returns {"brief": ..., "detail": ..., "reference": ...} on success,
    None on failure. Does not raise.
    """
    try:
        import anthropic
        from .config import get_env

        env = get_env()
        api_key = env.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set — skipping AI generation")
            return None

        client = anthropic.Anthropic(api_key=api_key)
        user_prompt = _build_user_prompt(
            question_text, answer_standard, answer_advanced
        )

        response = client.messages.create(
            model=PROGRESSIVE_DEPTH_MODEL,
            max_tokens=PROGRESSIVE_DEPTH_MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        if not response.content or not response.content[0].text:
            logger.warning("Empty AI response for progressive-depth generation")
            return None

        return _parse_ai_response(response.content[0].text)

    except Exception as e:
        logger.warning("AI progressive-depth generation failed: %s", e)
        return None


def generate_progressive_depth(
    question_text: str,
    answer_standard: str | None,
    answer_advanced: str | None,
    *,
    content_type: str = "q_a_pair",
    use_ai: bool = True,
) -> dict[str, str] | None:
    """Generate progressive-depth columns for a content item.

    Parameters
    ----------
    question_text : str
        The Q&A question text.
    answer_standard : str or None
        The standard answer text.
    answer_advanced : str or None
        The advanced answer text (may be None).
    content_type : str
        Content type — only 'q_a_pair' is processed; others return None.
    use_ai : bool
        Whether to attempt AI generation before deterministic fallback.

    Returns
    -------
    dict or None
        {"brief": ..., "detail": ..., "reference": ...} if generation
        succeeded, None if the content type is not q_a_pair or if there
        is insufficient content to generate from.
    """
    if content_type != "q_a_pair":
        return None

    if not question_text or not question_text.strip():
        return None

    if not answer_standard or not answer_standard.strip():
        return None

    # Try AI generation first (if enabled)
    if use_ai:
        ai_result = generate_progressive_depth_ai(
            question_text, answer_standard, answer_advanced
        )
        if ai_result is not None:
            return ai_result
        logger.info(
            "AI generation failed — falling back to deterministic extraction"
        )

    # Deterministic fallback
    return deterministic_fallback(question_text, answer_standard, answer_advanced)
