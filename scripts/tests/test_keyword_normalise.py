"""Shared parity tests for normalise_keyword() using the JSON fixture corpus.

Reads the same fixture file as the TS normalise-tag.test.ts to ensure
both normalisers produce identical output for identical input.
Spec: docs/specs/p0-tag-canonicalisation-classify-time-spec.md ss10.1/ss10.3.
"""

import json
import os
import re
import sys

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import normalise_keyword, _to_singular

# ── Load shared fixture corpus ──────────────────────────────────────────────

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "__tests__",
    "fixtures",
    "keyword-normalisation-cases.json",
)

with open(FIXTURE_PATH, encoding="utf-8") as f:
    FIXTURE_CASES = json.load(f)


class TestSharedParityFixture:
    """Fixture-driven parity tests — same corpus as TS normalise-tag.test.ts."""

    def test_fixture_has_at_least_20_cases(self):
        """The shared fixture corpus must have >= 20 cases per spec ss10.1."""
        assert len(FIXTURE_CASES) >= 20

    @pytest.mark.parametrize(
        "case",
        FIXTURE_CASES,
        ids=[c["description"] for c in FIXTURE_CASES],
    )
    def test_normalise_keyword_matches_expected(self, case):
        """normalise_keyword(input) == expected for every fixture case."""
        assert normalise_keyword(case["input"]) == case["expected"]


class TestReAsciiParity:
    """Verify that the whitespace-collapse regex uses re.ASCII behaviour.

    Python 3 default \\s matches Unicode whitespace (including U+00A0 NBSP).
    The normaliser must use re.ASCII so that only ASCII whitespace is collapsed,
    maintaining parity with the TS regex /[\\t\\n\\r\\f\\v ]+/g.
    """

    def test_nbsp_not_matched_by_ascii_whitespace_regex(self):
        """U+00A0 (non-breaking space) must NOT be collapsed by the normaliser.

        If the regex used default (Unicode) mode, NBSP would be collapsed
        to a regular space — which would break parity with the JS regex.
        """
        nbsp = " "
        input_kw = f"data{nbsp}protection"
        result = normalise_keyword(input_kw)
        # NBSP is NOT in the ASCII whitespace set, so it should be preserved.
        # The keyword lowercases but keeps the NBSP character intact.
        assert nbsp in result, (
            f"NBSP was collapsed — re.ASCII flag may be missing. "
            f"Got: {result!r}"
        )

    def test_ascii_whitespace_is_collapsed(self):
        """Tab, newline, and multi-space ARE collapsed (ASCII whitespace)."""
        assert normalise_keyword("risk\t\tmanagement") == "risk management"
        assert normalise_keyword("risk\n management") == "risk management"
        assert normalise_keyword("data   protection") == "data protection"

    def test_raw_re_ascii_flag(self):
        """Directly verify re.ASCII flag behaviour on the character class."""
        pattern = re.compile(r"[\t\n\r\f\v ]+", flags=re.ASCII)
        nbsp = " "

        # ASCII whitespace should match
        assert pattern.search("\t") is not None
        assert pattern.search(" ") is not None

        # NBSP should NOT match under re.ASCII
        assert pattern.search(nbsp) is None


class TestSisOusGuards:
    """Verify the sis/ous guards added for TS parity."""

    def test_sis_guard_analysis(self):
        """'analysis' must NOT be stripped to 'analysi'."""
        assert _to_singular("analysis") == "analysis"

    def test_sis_guard_diagnosis(self):
        """'diagnosis' must NOT be stripped to 'diagnosi'."""
        assert _to_singular("diagnosis") == "diagnosis"

    def test_ous_guard_continuous(self):
        """'continuous' must NOT be stripped to 'continuou'."""
        assert _to_singular("continuous") == "continuous"

    def test_ous_guard_previous(self):
        """'previous' must NOT be stripped to 'previou'."""
        assert _to_singular("previous") == "previous"

    def test_ous_guard_dangerous(self):
        """'dangerous' contains 'ous' and must NOT be stripped."""
        assert _to_singular("dangerous") == "dangerous"

    def test_normalise_keyword_analysis(self):
        """Full normalise_keyword preserves 'analysis'."""
        assert normalise_keyword("analysis") == "analysis"

    def test_normalise_keyword_continuous(self):
        """Full normalise_keyword preserves 'continuous'."""
        assert normalise_keyword("continuous") == "continuous"
