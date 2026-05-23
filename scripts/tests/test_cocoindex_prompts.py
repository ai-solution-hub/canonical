"""Smoke + structure tests for `scripts/cocoindex_pipeline/prompts.py`.

Per Q-EX2 §3.1 — the three instruction prompts are stable string constants
consumed by Wave 4 (Subtask 28.12) extractor wiring. These tests guard
against accidental empty / truncated prompts and confirm each prompt
references its expected `extraction_kind` value verbatim.
"""

from __future__ import annotations

import pytest

from scripts.cocoindex_pipeline.prompts import (
    CLASSIFICATION_PROMPT,
    ENTITY_MENTION_PROMPT,
    Q_A_FORM_PROMPT,
)


_ALL_PROMPTS = {
    "CLASSIFICATION_PROMPT": CLASSIFICATION_PROMPT,
    "Q_A_FORM_PROMPT": Q_A_FORM_PROMPT,
    "ENTITY_MENTION_PROMPT": ENTITY_MENTION_PROMPT,
}


class TestPromptsNonEmpty:
    """Smoke — every prompt must be a non-empty string."""

    @pytest.mark.parametrize("name,prompt", _ALL_PROMPTS.items())
    def test_prompt_non_empty(self, name: str, prompt: str) -> None:
        assert isinstance(prompt, str)
        assert prompt.strip(), f"{name} is empty"

    @pytest.mark.parametrize("name,prompt", _ALL_PROMPTS.items())
    def test_prompt_minimum_length(self, name: str, prompt: str) -> None:
        """Prompts should be substantial — at least 100 words."""
        word_count = len(prompt.split())
        assert word_count >= 100, (
            f"{name} has only {word_count} words; expected >=100"
        )


class TestPromptsStructure:
    """Structure — each prompt mentions JSON + its expected extraction_kind."""

    @pytest.mark.parametrize("name,prompt", _ALL_PROMPTS.items())
    def test_prompt_mentions_json(self, name: str, prompt: str) -> None:
        """Every prompt must direct JSON-only output."""
        assert "JSON" in prompt, f"{name} does not mention JSON"

    def test_classification_mentions_extraction_kind_value(self) -> None:
        """CLASSIFICATION_PROMPT must reference extraction_kind: classification."""
        assert "classification" in CLASSIFICATION_PROMPT
        assert "extraction_kind" in CLASSIFICATION_PROMPT

    def test_q_a_form_mentions_extraction_kind_value(self) -> None:
        """Q_A_FORM_PROMPT must reference extraction_kind: q_a_form."""
        assert "q_a_form" in Q_A_FORM_PROMPT
        assert "extraction_kind" in Q_A_FORM_PROMPT

    def test_entity_mention_mentions_extraction_kind_value(self) -> None:
        """ENTITY_MENTION_PROMPT must reference extraction_kind: entity_mention."""
        assert "entity_mention" in ENTITY_MENTION_PROMPT
        assert "extraction_kind" in ENTITY_MENTION_PROMPT


class TestPromptsNoMarkdownFences:
    """Each prompt directs the model NOT to use markdown fences in output."""

    @pytest.mark.parametrize("name,prompt", _ALL_PROMPTS.items())
    def test_no_fence_instruction_present(
        self, name: str, prompt: str
    ) -> None:
        """Search for an explicit "no markdown fences" instruction.

        The actual phrasing per prompts.py is "no markdown fences" — any
        prompt missing this is at risk of the model emitting
        ```json ... ``` wrapping that breaks Pydantic JSON parse.
        """
        assert "markdown fences" in prompt.lower(), (
            f"{name} missing explicit 'no markdown fences' instruction"
        )


class TestPromptsEnumeratesEnums:
    """Each prompt enumerates the relevant canonical enum values verbatim.

    This is a regression guard against prompt drift — if a new
    content_type / form_type / entity_type is added but the prompt is not
    updated, the LLM will not know about the new value.
    """

    def test_classification_enumerates_content_types(self) -> None:
        """CLASSIFICATION_PROMPT should list the canonical content_type values."""
        # At minimum, the snake_case core values should be mentioned.
        required = {
            "article",
            "policy",
            "research",
            "methodology",
            "capability",
            "case_study",
            "certification",
            "compliance",
        }
        missing = [v for v in required if v not in CLASSIFICATION_PROMPT]
        assert not missing, (
            f"CLASSIFICATION_PROMPT missing content_type values: {missing}"
        )

    def test_q_a_form_enumerates_form_types(self) -> None:
        """Q_A_FORM_PROMPT should list the 11 canonical form_type values."""
        form_types = {
            "bid",
            "rfp",
            "pqq",
            "itt",
            "tender",
            "framework",
            "dps",
            "gcloud",
            "checklist",
            "questionnaire",
            "sales_proposal_template",
        }
        missing = [v for v in form_types if v not in Q_A_FORM_PROMPT]
        assert not missing, (
            f"Q_A_FORM_PROMPT missing form_type values: {missing}"
        )

    def test_q_a_form_enumerates_expected_response_kind(self) -> None:
        """Per verifier B-1 — only mandatory + optional; NOT info_only."""
        assert "mandatory" in Q_A_FORM_PROMPT
        assert "optional" in Q_A_FORM_PROMPT
        # The prompt should also explicitly forbid info_only to prevent
        # prompt-drift regression.
        assert "info_only" in Q_A_FORM_PROMPT.lower(), (
            "Q_A_FORM_PROMPT should explicitly forbid the unratified "
            "'info_only' value to prevent verifier B-1 regression"
        )

    def test_entity_mention_enumerates_12_entity_types(self) -> None:
        """ENTITY_MENTION_PROMPT must list all 12 canonical entity_type values."""
        entity_types = {
            "organisation",
            "certification",
            "regulation",
            "framework",
            "capability",
            "person",
            "technology",
            "project",
            "sector",
            "product",
            "standard",
            "methodology",
        }
        missing = [v for v in entity_types if v not in ENTITY_MENTION_PROMPT]
        assert not missing, (
            f"ENTITY_MENTION_PROMPT missing entity_type values: {missing}"
        )
