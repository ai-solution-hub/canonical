"""Layer Inference — Deterministic Content Layer Suggestion (Python).

Pure Python function that suggests a content layer assignment based on
information known at creation time. No AI calls, no database queries —
evaluates rules in priority order and returns the first match.

This is a direct port of lib/layer-inference.ts for use in the Python
ingestion pipeline. The 7-rule priority logic is identical.

Spec: docs/specs/layer-suggestion-spec.md (Section 3)
"""

from dataclasses import dataclass
from typing import Literal

# ---------------------------------------------------------------------------
# Layer key constants — sourced from CLIENT_CONFIG.layer_vocabulary
# ---------------------------------------------------------------------------

LAYER_SALES_BRIEF = "sales_brief"
LAYER_BID_DETAIL = "bid_detail"
LAYER_COMPANY_REFERENCE = "company_reference"
LAYER_RESEARCH = "research"

# ---------------------------------------------------------------------------
# Content type sets for Rule 4
# ---------------------------------------------------------------------------

COMPANY_REFERENCE_TYPES = frozenset({"policy", "compliance", "certification"})
BID_DETAIL_TYPES = frozenset({"product_description", "capability", "methodology"})

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

Confidence = Literal["high", "medium", "low"]


@dataclass(frozen=True)
class LayerSuggestion:
    """Result of layer inference — suggested layer, reason, and confidence."""

    suggested_layer: str
    reason: str
    confidence: Confidence


# ---------------------------------------------------------------------------
# Inference function
# ---------------------------------------------------------------------------


def infer_layer(
    *,
    content_type: str = "",
    content_length: int = 0,
    ingestion_source: str = "manual",
    has_brief: bool = False,
    has_detail: bool = False,
    has_reference: bool = False,
    is_bid_discovered: bool = False,
    title: str = "",
) -> LayerSuggestion:
    """Infer the most appropriate content layer for a new item.

    Evaluates 7 rules in strict priority order (top-to-bottom) and returns
    the first match. Every code path returns a valid LayerSuggestion —
    the final rule is a catch-all default.

    This is a **pure function**: no side effects, no database access,
    no asynchronous operations.

    Args:
        content_type: Content type (e.g. 'q_a_pair', 'article', 'policy').
        content_length: Plain text length in characters.
        ingestion_source: How the item was created ('manual', 'url_import',
            'upload', 'bid_library').
        has_brief: Whether the brief progressive depth field is populated.
        has_detail: Whether the detail progressive depth field is populated.
        has_reference: Whether the reference progressive depth field is populated.
        is_bid_discovered: Whether the item originated from a bid workspace.
        title: Title text (for keyword heuristics — reserved for future use).

    Returns:
        LayerSuggestion with suggested_layer, reason, and confidence.
    """
    # Rule 1: Bid-discovered content
    if is_bid_discovered:
        return LayerSuggestion(
            suggested_layer=LAYER_BID_DETAIL,
            reason="Content discovered through a bid workspace is typically bid-level detail",
            confidence="high",
        )

    # Rule 2: Bid library Q&A pairs
    if ingestion_source == "bid_library" and content_type == "q_a_pair":
        return LayerSuggestion(
            suggested_layer=LAYER_BID_DETAIL,
            reason="Q&A pairs imported from bid documents are bid-level detail",
            confidence="high",
        )

    # Rule 3: Progressive depth field presence
    if has_reference:
        return LayerSuggestion(
            suggested_layer=LAYER_COMPANY_REFERENCE,
            reason="Reference field populated — company reference layer",
            confidence="high",
        )

    if has_detail and has_brief:
        return LayerSuggestion(
            suggested_layer=LAYER_BID_DETAIL,
            reason="Both brief and detail fields populated — bid-level depth",
            confidence="medium",
        )

    if has_brief and not has_detail:
        return LayerSuggestion(
            suggested_layer=LAYER_SALES_BRIEF,
            reason="Brief field populated without detail — sales brief depth",
            confidence="medium",
        )

    # Rule 4: Content type mapping
    if content_type in COMPANY_REFERENCE_TYPES:
        return LayerSuggestion(
            suggested_layer=LAYER_COMPANY_REFERENCE,
            reason="Policies and compliance documents are typically company reference material",
            confidence="medium",
        )

    if content_type == "research":
        return LayerSuggestion(
            suggested_layer=LAYER_RESEARCH,
            reason="Research content type maps directly to the research layer",
            confidence="high",
        )

    if content_type == "case_study":
        return LayerSuggestion(
            suggested_layer=LAYER_BID_DETAIL,
            reason="Case studies are typically used as bid evidence",
            confidence="medium",
        )

    if content_type in BID_DETAIL_TYPES:
        return LayerSuggestion(
            suggested_layer=LAYER_BID_DETAIL,
            reason="Product/capability descriptions are typically bid-level detail",
            confidence="medium",
        )

    # Rule 5: Content length heuristics
    if content_type == "q_a_pair" and content_length < 500:
        return LayerSuggestion(
            suggested_layer=LAYER_SALES_BRIEF,
            reason="Short Q&A pair — likely sales-brief depth",
            confidence="low",
        )

    if content_type == "q_a_pair" and content_length >= 500:
        return LayerSuggestion(
            suggested_layer=LAYER_BID_DETAIL,
            reason="Detailed Q&A pair — likely bid-detail depth",
            confidence="low",
        )

    if content_length < 300:
        return LayerSuggestion(
            suggested_layer=LAYER_SALES_BRIEF,
            reason="Very short content — likely a brief or positioning piece",
            confidence="low",
        )

    if content_length > 3000:
        return LayerSuggestion(
            suggested_layer=LAYER_COMPANY_REFERENCE,
            reason="Long content — likely reference or detailed documentation",
            confidence="low",
        )

    # Rule 6: Source-based fallback
    if ingestion_source == "url_import":
        return LayerSuggestion(
            suggested_layer=LAYER_RESEARCH,
            reason="Web-imported content is often research or background material",
            confidence="low",
        )

    # Rule 7: Default
    return LayerSuggestion(
        suggested_layer=LAYER_BID_DETAIL,
        reason="Default suggestion — bid detail is the most common layer",
        confidence="low",
    )
