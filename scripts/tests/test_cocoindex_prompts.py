"""Smoke + structure tests for `scripts/cocoindex_pipeline/prompts.py`.

Per Q-EX2 §3.1 — the three instruction prompts are stable string constants
consumed by Wave 4 (Subtask 28.12) extractor wiring. These tests guard
against accidental empty / truncated prompts and confirm each prompt
references its expected `extraction_kind` value verbatim.
"""

from __future__ import annotations

import json
import re

import pytest

from scripts.cocoindex_pipeline.prompts import (
    CLASSIFICATION_PROMPT,
    ENTITY_MENTION_PROMPT,
    Q_A_FORM_PROMPT,
)


def _parse_prompt_form_types(prompt: str) -> set[str]:
    """Extract the form_type values the prompt instructs the model to emit.

    Parses the machine-readable FIELD CONSTRAINTS line
    ``form_metadata.form_type: MUST be ONE of: <values>.`` and splits the
    captured list on commas. Returns the set of snake_case form_type keys.
    """
    match = re.search(
        r"form_metadata\.form_type: MUST be ONE of:\s*(.+?)\.",
        prompt,
        re.S,
    )
    assert match is not None, (
        "Q_A_FORM_PROMPT no longer contains a parseable "
        "'form_metadata.form_type: MUST be ONE of: ...' FIELD CONSTRAINTS line"
    )
    return {value.strip() for value in match.group(1).split(",") if value.strip()}


def _parse_prompt_content_types(prompt: str) -> set[str]:
    """Extract the content_type values the prompt instructs the model to emit.

    Parses the machine-readable FIELD CONSTRAINTS block
    ``content_type: MUST be ONE of the following canonical values:\n  <values>.``
    and splits the captured list on commas. The values sit on the line
    following the label (with a two-space indent), so the regex spans the
    newline via ``re.S``. Returns the set of snake_case content_type keys.
    """
    match = re.search(
        r"content_type: MUST be ONE of the following canonical values:\s*(.+?)\.",
        prompt,
        re.S,
    )
    assert match is not None, (
        "CLASSIFICATION_PROMPT no longer contains a parseable "
        "'content_type: MUST be ONE of the following canonical values: ...' "
        "FIELD CONSTRAINTS block"
    )
    return {value.strip() for value in match.group(1).split(",") if value.strip()}


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
        """CLASSIFICATION_PROMPT must enumerate EXACTLY the snapshot-backed
        canonical content_type set — no weak subset, no frozen literal.

        This is a bidirectional regression guard: it fails loudly on drift in
        EITHER direction. If a content_type is added to the taxonomy snapshot
        but not to the prompt (the LLM would never emit it), the
        snapshot-minus-prompt direction fails. If the prompt names a value the
        validator would reject (not in the snapshot), the prompt-minus-snapshot
        direction fails. The expectation derives from the single source of
        truth — `_VALID_CONTENT_TYPES`, loaded from the taxonomy snapshot by
        extraction.py — never a hardcoded literal.
        """
        from scripts.cocoindex_pipeline.extraction import _VALID_CONTENT_TYPES

        prompt_content_types = _parse_prompt_content_types(CLASSIFICATION_PROMPT)
        snapshot_content_types = set(_VALID_CONTENT_TYPES)

        missing_from_prompt = snapshot_content_types - prompt_content_types
        extra_in_prompt = prompt_content_types - snapshot_content_types
        assert not missing_from_prompt and not extra_in_prompt, (
            "CLASSIFICATION_PROMPT content_type set is not in exact parity "
            "with the snapshot-backed _VALID_CONTENT_TYPES.\n"
            f"  In snapshot but missing from prompt: {sorted(missing_from_prompt)}\n"
            f"  In prompt but rejected by validator:  {sorted(extra_in_prompt)}"
        )

    def test_q_a_form_enumerates_form_types(self, tmp_path) -> None:
        """Q_A_FORM_PROMPT must enumerate exactly the snapshot-backed canonical
        form_type set (no frozen literal)."""
        # Expectation derives from the single source of truth — the taxonomy
        # snapshot, loaded by extraction.py — never a hardcoded literal.
        from scripts.cocoindex_pipeline.extraction import _VALID_FORM_TYPES

        prompt_form_types = _parse_prompt_form_types(Q_A_FORM_PROMPT)

        # Bidirectional parity (folds Inv-2: the prompt names nothing the
        # validator would reject as invalid_enum).
        missing_from_prompt = set(_VALID_FORM_TYPES) - prompt_form_types
        assert not missing_from_prompt, (
            "Q_A_FORM_PROMPT omits canonical form_type values present in "
            f"_VALID_FORM_TYPES: {sorted(missing_from_prompt)}"
        )
        extra_in_prompt = prompt_form_types - set(_VALID_FORM_TYPES)
        assert not extra_in_prompt, (
            "Q_A_FORM_PROMPT names form_type values the validator rejects "
            f"(not in _VALID_FORM_TYPES): {sorted(extra_in_prompt)}"
        )

        # Inv-3 drift-tracking: the expectation must MOVE when the snapshot
        # changes — proving it is data-derived, not a frozen list. Copy the
        # snapshot, mutate its form_types, monkeypatch the loader path, and
        # confirm the canonical set tracks the mutation.
        from scripts.cocoindex_pipeline import extraction as extraction_mod

        original_snapshot = json.loads(
            extraction_mod._TAXONOMY_SNAPSHOT_PATH.read_text()
        )
        mutated_snapshot = json.loads(json.dumps(original_snapshot))
        mutated_snapshot["form_types"].append(
            {"key": "drift_probe_form_type", "label": "Drift Probe"}
        )
        mutated_path = tmp_path / "taxonomy_snapshot.json"
        mutated_path.write_text(json.dumps(mutated_snapshot))

        baseline = extraction_mod._load_canonical_form_types()
        original_path = extraction_mod._TAXONOMY_SNAPSHOT_PATH
        try:
            extraction_mod._TAXONOMY_SNAPSHOT_PATH = mutated_path
            drifted = extraction_mod._load_canonical_form_types()
        finally:
            extraction_mod._TAXONOMY_SNAPSHOT_PATH = original_path

        assert "drift_probe_form_type" not in baseline, (
            "drift probe leaked into the real snapshot-derived set"
        )
        assert "drift_probe_form_type" in drifted, (
            "the canonical form_type set did not track the mutated snapshot — "
            "the expectation is frozen, not data-derived"
        )
        assert drifted == (baseline | {"drift_probe_form_type"}), (
            "snapshot mutation did not move the expectation by exactly the "
            f"added key (baseline={sorted(baseline)}, drifted={sorted(drifted)})"
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
