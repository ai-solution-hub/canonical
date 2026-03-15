"""Tests for summarise.py — AI summary generation via Claude tool-use mode.

Note: summarise.py uses a lazy `import anthropic` inside generate_summary(),
so we mock it via sys.modules injection rather than @patch on a module attribute.
"""

import sys
import os
from unittest.mock import patch, MagicMock

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.summarise import (
    generate_summary,
    MAX_SUMMARY_CONTENT_LENGTH,
    SONNET_INPUT_PRICE,
    SONNET_OUTPUT_PRICE,
)


def _make_tool_use_response(tool_result, input_tokens=500, output_tokens=200,
                             stop_reason="end_turn"):
    """Build a mock Anthropic response with a tool_use block."""
    response = MagicMock()
    response.stop_reason = stop_reason

    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.name = "return_summary"
    tool_block.input = tool_result
    response.content = [tool_block]

    usage = MagicMock()
    usage.input_tokens = input_tokens
    usage.output_tokens = output_tokens
    response.usage = usage

    return response


def _valid_summary():
    """Return a valid summary tool result."""
    return {
        "executive": "A concise executive summary of the content.",
        "detailed": "A detailed multi-paragraph summary.",
        "takeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3"],
    }


@pytest.fixture()
def mock_anthropic():
    """Fixture that patches the anthropic module with a mock client.

    Since summarise.py does `import anthropic` inside generate_summary(),
    we inject a mock module into sys.modules so the import picks it up.
    """
    mock_module = MagicMock()
    mock_client = MagicMock()
    mock_module.Anthropic.return_value = mock_client

    original = sys.modules.get("anthropic")
    sys.modules["anthropic"] = mock_module

    yield mock_client

    # Restore original
    if original is not None:
        sys.modules["anthropic"] = original
    else:
        sys.modules.pop("anthropic", None)


class TestGenerateSummary:
    """Tests for generate_summary function (Anthropic API mocked)."""

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_successful_summary(self, mock_anthropic):
        """Successful summary returns dict with expected keys."""
        mock_anthropic.messages.create.return_value = _make_tool_use_response(
            _valid_summary(), input_tokens=400, output_tokens=100
        )

        result = generate_summary("Title", "Content body", "article")

        assert result is not None
        assert result["executive"] == "A concise executive summary of the content."
        assert result["detailed"] == "A detailed multi-paragraph summary."
        assert result["takeaways"] == ["Takeaway 1", "Takeaway 2", "Takeaway 3"]
        assert "model" in result
        assert "cost" in result
        assert "generated_at" in result

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_content_truncated_to_max_length(self, mock_anthropic):
        """Content longer than MAX_SUMMARY_CONTENT_LENGTH is truncated."""
        mock_anthropic.messages.create.return_value = _make_tool_use_response(_valid_summary())

        long_content = "x" * (MAX_SUMMARY_CONTENT_LENGTH + 5000)
        generate_summary("Title", long_content, "article")

        call_args = mock_anthropic.messages.create.call_args
        prompt_text = call_args.kwargs["messages"][0]["content"]
        # The truncated content should not exceed MAX_SUMMARY_CONTENT_LENGTH
        assert ("x" * (MAX_SUMMARY_CONTENT_LENGTH + 1)) not in prompt_text

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_tool_use_response_parsed(self, mock_anthropic):
        """Tool-use block is correctly parsed from response content."""
        summary = _valid_summary()
        summary["executive"] = "Specific exec summary"
        mock_anthropic.messages.create.return_value = _make_tool_use_response(summary)

        result = generate_summary("Title", "Content", "article")
        assert result["executive"] == "Specific exec summary"

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_token_counts_and_cost(self, mock_anthropic):
        """Token counts and cost are correctly calculated."""
        mock_anthropic.messages.create.return_value = _make_tool_use_response(
            _valid_summary(), input_tokens=1000, output_tokens=500
        )

        result = generate_summary("Title", "Content", "article")

        assert result["input_tokens"] == 1000
        assert result["output_tokens"] == 500
        assert result["tokens_used"] == 1500
        expected_cost = (1000 * SONNET_INPUT_PRICE) + (500 * SONNET_OUTPUT_PRICE)
        assert abs(result["cost"] - expected_cost) < 1e-10

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_transcript_type_uses_specific_prompt(self, mock_anthropic):
        """content_type='other' (transcript) uses transcript-specific prompt text."""
        mock_anthropic.messages.create.return_value = _make_tool_use_response(_valid_summary())

        generate_summary("Podcast Title", "Transcript...", "other")

        call_args = mock_anthropic.messages.create.call_args
        prompt_text = call_args.kwargs["messages"][0]["content"]
        assert "transcript" in prompt_text.lower()
        assert "speaker" in prompt_text.lower()

    def test_no_api_key_returns_none(self, mock_anthropic):
        """Returns None when ANTHROPIC_API_KEY is not set."""
        env_without_key = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with patch.dict(os.environ, env_without_key, clear=True), \
             patch("kb_pipeline.summarise.get_env", return_value={}):
            result = generate_summary("Title", "Content", "article")
        assert result is None

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_anthropic_import_fails_returns_none(self):
        """Returns None when anthropic package cannot be imported."""
        # Temporarily remove anthropic from sys.modules so the lazy import fails
        original = sys.modules.pop("anthropic", None)
        # Insert a broken entry that will cause import to fail
        import builtins
        real_import = builtins.__import__

        def failing_import(name, *args, **kwargs):
            if name == "anthropic":
                raise ImportError("No module named 'anthropic'")
            return real_import(name, *args, **kwargs)

        try:
            with patch("builtins.__import__", side_effect=failing_import):
                result = generate_summary("Title", "Content", "article")
            assert result is None
        finally:
            if original is not None:
                sys.modules["anthropic"] = original

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_max_tokens_stop_reason_returns_none(self, mock_anthropic):
        """Returns None when stop_reason is 'max_tokens'."""
        mock_anthropic.messages.create.return_value = _make_tool_use_response(
            _valid_summary(), stop_reason="max_tokens"
        )

        result = generate_summary("Title", "Content", "article")
        assert result is None

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_no_tool_use_block_returns_none(self, mock_anthropic):
        """Returns None when response has no tool_use block."""
        response = MagicMock()
        response.stop_reason = "end_turn"
        text_block = MagicMock()
        text_block.type = "text"
        text_block.name = "text"
        response.content = [text_block]
        response.usage = MagicMock(input_tokens=100, output_tokens=50)
        mock_anthropic.messages.create.return_value = response

        result = generate_summary("Title", "Content", "article")
        assert result is None

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_invalid_summary_structure_returns_none(self, mock_anthropic):
        """Returns None when summary structure is invalid (missing required fields)."""
        bad_summary = {"detailed": "text", "takeaways": ["a"]}
        mock_anthropic.messages.create.return_value = _make_tool_use_response(bad_summary)

        result = generate_summary("Title", "Content", "article")
        assert result is None

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_api_exception_returns_none(self, mock_anthropic):
        """Returns None when the API raises an exception."""
        mock_anthropic.messages.create.side_effect = Exception("API timeout")

        result = generate_summary("Title", "Content", "article")
        assert result is None

    @patch.dict(os.environ, {
        "ANTHROPIC_API_KEY": "test-key",
        "AI_SUMMARY_MODEL": "claude-haiku-3",
    }, clear=False)
    def test_uses_ai_summary_model_env_var(self, mock_anthropic):
        """Uses AI_SUMMARY_MODEL env var when set."""
        mock_anthropic.messages.create.return_value = _make_tool_use_response(_valid_summary())

        result = generate_summary("Title", "Content", "article")

        call_args = mock_anthropic.messages.create.call_args
        assert call_args.kwargs["model"] == "claude-haiku-3"
        assert result["model"] == "claude-haiku-3"

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}, clear=False)
    def test_defaults_to_sonnet_model(self, mock_anthropic):
        """Defaults to claude-sonnet-4-6 when AI_SUMMARY_MODEL is not set."""
        os.environ.pop("AI_SUMMARY_MODEL", None)

        mock_anthropic.messages.create.return_value = _make_tool_use_response(_valid_summary())

        result = generate_summary("Title", "Content", "article")

        call_args = mock_anthropic.messages.create.call_args
        assert call_args.kwargs["model"] == "claude-sonnet-4-6"
