"""Tests for scripts/kb_pipeline/progressive_depth.py — progressive-depth generation.

Covers:
- Deterministic fallback produces correct shape (brief = first para,
  detail = full answer, reference = question)
- AI path wraps the prompt correctly (mock anthropic.messages.create)
- AI failure triggers deterministic fallback (does not raise)
- Empty answer_standard returns None for all three columns (skip)
- Non-q_a_pair content_type is a no-op when called
- JSON parsing edge cases (markdown fencing, missing keys)
"""

from __future__ import annotations

import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

# Ensure scripts/ is on sys.path so kb_pipeline imports resolve.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.progressive_depth import (
    PROGRESSIVE_DEPTH_MAX_TOKENS,
    PROGRESSIVE_DEPTH_MODEL,
    SYSTEM_PROMPT,
    _build_user_prompt,
    _extract_first_paragraph,
    _parse_ai_response,
    deterministic_fallback,
    generate_progressive_depth,
    generate_progressive_depth_ai,
)


# ──────────────────────────────────────────────────────────────────────
# Deterministic fallback
# ──────────────────────────────────────────────────────────────────────


class TestDeterministicFallback:
    """Deterministic fallback extracts brief/detail/reference from raw fields."""

    def test_basic_shape(self):
        result = deterministic_fallback(
            question_text="What is ISO 27001?",
            answer_standard="ISO 27001 is an international standard.\n\nIt covers information security.",
            answer_advanced="The certification process involves audits.",
        )
        assert result is not None
        assert set(result.keys()) == {"brief", "detail", "reference"}

    def test_brief_is_first_paragraph(self):
        result = deterministic_fallback(
            question_text="What is ISO 27001?",
            answer_standard="ISO 27001 is an international standard.\n\nIt covers information security.",
            answer_advanced=None,
        )
        assert result["brief"] == "ISO 27001 is an international standard."

    def test_brief_single_paragraph(self):
        """When answer_standard has no paragraph break, brief = full text."""
        result = deterministic_fallback(
            question_text="What is it?",
            answer_standard="A single paragraph with no breaks.",
            answer_advanced=None,
        )
        assert result["brief"] == "A single paragraph with no breaks."

    def test_detail_concatenates_standard_and_advanced(self):
        result = deterministic_fallback(
            question_text="What is ISO 27001?",
            answer_standard="Standard answer here.",
            answer_advanced="Advanced answer here.",
        )
        assert result["detail"] == "Standard answer here.\n\nAdvanced answer here."

    def test_detail_standard_only(self):
        result = deterministic_fallback(
            question_text="What is ISO 27001?",
            answer_standard="Standard answer here.",
            answer_advanced=None,
        )
        assert result["detail"] == "Standard answer here."

    def test_detail_advanced_empty_string(self):
        result = deterministic_fallback(
            question_text="What is ISO 27001?",
            answer_standard="Standard answer here.",
            answer_advanced="   ",
        )
        assert result["detail"] == "Standard answer here."

    def test_reference_is_question_text(self):
        result = deterministic_fallback(
            question_text="What is ISO 27001?",
            answer_standard="Some answer.",
            answer_advanced=None,
        )
        assert result["reference"] == "What is ISO 27001?"

    def test_empty_answer_standard_returns_none(self):
        assert deterministic_fallback(
            question_text="What?", answer_standard="", answer_advanced=None
        ) is None

    def test_none_answer_standard_returns_none(self):
        assert deterministic_fallback(
            question_text="What?", answer_standard=None, answer_advanced=None
        ) is None

    def test_whitespace_answer_standard_returns_none(self):
        assert deterministic_fallback(
            question_text="What?", answer_standard="   ", answer_advanced=None
        ) is None

    def test_empty_question_text_returns_none(self):
        assert deterministic_fallback(
            question_text="", answer_standard="Answer.", answer_advanced=None
        ) is None


# ──────────────────────────────────────────────────────────────────────
# First paragraph extraction helper
# ──────────────────────────────────────────────────────────────────────


class TestExtractFirstParagraph:
    def test_multiple_paragraphs(self):
        text = "First paragraph.\n\nSecond paragraph.\n\nThird."
        assert _extract_first_paragraph(text) == "First paragraph."

    def test_single_paragraph(self):
        assert _extract_first_paragraph("Just one line.") == "Just one line."

    def test_leading_whitespace(self):
        assert _extract_first_paragraph("\n\nActual text.") == "Actual text."

    def test_empty_string(self):
        assert _extract_first_paragraph("") == ""


# ──────────────────────────────────────────────────────────────────────
# AI response parsing
# ──────────────────────────────────────────────────────────────────────


class TestParseAiResponse:
    def test_valid_json(self):
        raw = json.dumps({
            "brief": "Short summary.",
            "detail": "Full detail.",
            "reference": "Question text.",
        })
        result = _parse_ai_response(raw)
        assert result == {
            "brief": "Short summary.",
            "detail": "Full detail.",
            "reference": "Question text.",
        }

    def test_json_with_markdown_fencing(self):
        raw = '```json\n{"brief": "B", "detail": "D", "reference": "R"}\n```'
        result = _parse_ai_response(raw)
        assert result == {"brief": "B", "detail": "D", "reference": "R"}

    def test_missing_key_returns_none(self):
        raw = json.dumps({"brief": "B", "detail": "D"})
        assert _parse_ai_response(raw) is None

    def test_empty_value_returns_none(self):
        raw = json.dumps({"brief": "", "detail": "D", "reference": "R"})
        assert _parse_ai_response(raw) is None

    def test_invalid_json_returns_none(self):
        assert _parse_ai_response("not json at all") is None

    def test_non_dict_json_returns_none(self):
        assert _parse_ai_response('["a", "b"]') is None

    def test_strips_whitespace_from_values(self):
        raw = json.dumps({
            "brief": "  B  ",
            "detail": " D ",
            "reference": " R ",
        })
        result = _parse_ai_response(raw)
        assert result == {"brief": "B", "detail": "D", "reference": "R"}


# ──────────────────────────────────────────────────────────────────────
# User prompt construction
# ──────────────────────────────────────────────────────────────────────


class TestBuildUserPrompt:
    def test_includes_question(self):
        prompt = _build_user_prompt("What is X?", "Answer.", None)
        assert "Question: What is X?" in prompt

    def test_includes_standard_answer(self):
        prompt = _build_user_prompt("Q?", "Standard answer.", None)
        assert "Standard Answer:\nStandard answer." in prompt

    def test_includes_advanced_answer(self):
        prompt = _build_user_prompt("Q?", "S.", "Advanced answer.")
        assert "Advanced Answer:\nAdvanced answer." in prompt

    def test_no_advanced_section_when_none(self):
        prompt = _build_user_prompt("Q?", "S.", None)
        assert "Advanced Answer" not in prompt


# ──────────────────────────────────────────────────────────────────────
# AI generation path (mocked)
# ──────────────────────────────────────────────────────────────────────


class TestGenerateProgressiveDepthAi:
    """AI path wraps the prompt correctly and handles failures."""

    def _mock_anthropic_response(self, text: str):
        """Create a mock Anthropic response object."""
        content_block = SimpleNamespace(text=text)
        return SimpleNamespace(content=[content_block])

    def test_successful_ai_call(self, monkeypatch):
        """AI path returns parsed result on success."""
        # Mock anthropic module and config.get_env
        mock_anthropic = MagicMock()
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = self._mock_anthropic_response(
            json.dumps({
                "brief": "AI brief.",
                "detail": "AI detail.",
                "reference": "AI reference.",
            })
        )

        monkeypatch.setattr(
            "kb_pipeline.config.get_env",
            lambda: {"ANTHROPIC_API_KEY": "test-key"},
        )

        with patch.dict("sys.modules", {"anthropic": mock_anthropic}):
            result = generate_progressive_depth_ai(
                "What is X?", "Answer standard.", "Answer advanced."
            )

        assert result is not None
        assert result == {
            "brief": "AI brief.",
            "detail": "AI detail.",
            "reference": "AI reference.",
        }
        mock_client.messages.create.assert_called_once()
        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs["model"] == PROGRESSIVE_DEPTH_MODEL
        assert call_kwargs["max_tokens"] == PROGRESSIVE_DEPTH_MAX_TOKENS
        assert call_kwargs["system"] == SYSTEM_PROMPT

    def test_no_api_key_returns_none(self, monkeypatch):
        """Missing ANTHROPIC_API_KEY returns None without raising."""
        monkeypatch.setattr(
            "kb_pipeline.config.get_env",
            lambda: {"ANTHROPIC_API_KEY": ""},
        )
        result = generate_progressive_depth_ai("Q?", "A.", None)
        assert result is None

    def test_exception_returns_none(self, monkeypatch):
        """Any exception during AI call returns None (doesn't raise)."""
        monkeypatch.setattr(
            "kb_pipeline.config.get_env",
            lambda: {"ANTHROPIC_API_KEY": "test-key"},
        )

        # Patch anthropic module to None — forces ImportError inside function
        with patch.dict("sys.modules", {"anthropic": None}):
            result = generate_progressive_depth_ai("Q?", "A.", None)
            assert result is None


# ──────────────────────────────────────────────────────────────────────
# Main generate_progressive_depth entry point
# ──────────────────────────────────────────────────────────────────────


class TestGenerateProgressiveDepth:
    """Integration tests for the main entry point."""

    def test_non_qa_pair_returns_none(self):
        """Non-q_a_pair content types are a no-op."""
        result = generate_progressive_depth(
            question_text="What is X?",
            answer_standard="Answer.",
            answer_advanced=None,
            content_type="article",
            use_ai=False,
        )
        assert result is None

    def test_empty_question_returns_none(self):
        result = generate_progressive_depth(
            question_text="",
            answer_standard="Answer.",
            answer_advanced=None,
            content_type="q_a_pair",
            use_ai=False,
        )
        assert result is None

    def test_empty_answer_standard_returns_none(self):
        result = generate_progressive_depth(
            question_text="What?",
            answer_standard="",
            answer_advanced=None,
            content_type="q_a_pair",
            use_ai=False,
        )
        assert result is None

    def test_deterministic_mode(self):
        """With use_ai=False, returns deterministic fallback directly."""
        result = generate_progressive_depth(
            question_text="What is ISO 27001?",
            answer_standard="ISO 27001 is a security standard.\n\nIt requires audits.",
            answer_advanced="Advanced certification details.",
            content_type="q_a_pair",
            use_ai=False,
        )
        assert result is not None
        assert result["brief"] == "ISO 27001 is a security standard."
        assert "Advanced certification details." in result["detail"]
        assert result["reference"] == "What is ISO 27001?"

    def test_ai_failure_falls_back_to_deterministic(self, monkeypatch):
        """When AI generation fails, deterministic fallback is used."""
        monkeypatch.setattr(
            "kb_pipeline.progressive_depth.generate_progressive_depth_ai",
            lambda *args, **kwargs: None,
        )
        result = generate_progressive_depth(
            question_text="What is GDPR?",
            answer_standard="GDPR is data protection regulation.",
            answer_advanced=None,
            content_type="q_a_pair",
            use_ai=True,
        )
        assert result is not None
        assert result["brief"] == "GDPR is data protection regulation."
        assert result["reference"] == "What is GDPR?"

    def test_ai_success_uses_ai_result(self, monkeypatch):
        """When AI generation succeeds, its result is used (not fallback)."""
        ai_result = {
            "brief": "AI-generated brief.",
            "detail": "AI-generated detail.",
            "reference": "AI-generated reference.",
        }
        monkeypatch.setattr(
            "kb_pipeline.progressive_depth.generate_progressive_depth_ai",
            lambda *args, **kwargs: ai_result,
        )
        result = generate_progressive_depth(
            question_text="What is X?",
            answer_standard="Answer.",
            answer_advanced=None,
            content_type="q_a_pair",
            use_ai=True,
        )
        assert result == ai_result

    def test_content_type_blog(self):
        """Blog content type is a no-op."""
        result = generate_progressive_depth(
            question_text="What?",
            answer_standard="Answer.",
            answer_advanced=None,
            content_type="blog",
            use_ai=False,
        )
        assert result is None

    def test_content_type_case_sensitive(self):
        """Content type check is case-sensitive — Q_A_PAIR is not q_a_pair."""
        result = generate_progressive_depth(
            question_text="What?",
            answer_standard="Answer.",
            answer_advanced=None,
            content_type="Q_A_PAIR",
            use_ai=False,
        )
        assert result is None
