"""D-8 (ID-75.7) — URL-normalisation parity tests.

Every case in scripts/tests/fixtures/url_normalisation_parity.json must pass
against ``normalise_url``. The same fixture is consumed by the Vitest guard
(__tests__/validation/url-normalisation-parity.test.ts) against the TS
``normaliseUrl`` (lib/intelligence/content-extractor.ts) — the fixture is the
single source of truth for both sides, so drift on either side breaks tests on
both sides (BI-2/BI-8 parity seam).
"""

import json
import os

import pytest

from scripts.cocoindex_pipeline.url_normalise import normalise_url

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "fixtures", "url_normalisation_parity.json"
)


def _load_cases() -> list[dict[str, str]]:
    with open(FIXTURE_PATH, encoding="utf-8") as handle:
        return json.load(handle)["cases"]


CASES = _load_cases()
CASE_IDS = [case["name"] for case in CASES]


def test_fixture_has_cases() -> None:
    """Guard against an emptied fixture silently passing the suite."""
    assert len(CASES) > 0


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_fixture_case(case: dict[str, str]) -> None:
    """normalise_url(input) == expected for every shared fixture case."""
    assert normalise_url(case["input"]) == case["expected"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_idempotent(case: dict[str, str]) -> None:
    """normalise_url(normalise_url(x)) == normalise_url(x) for every case.

    feed_articles.external_url is stored already-normalised (by the TS
    pipeline); the Python side re-applies normalise_url defensively, so the
    function MUST be a no-op on its own output.
    """
    once = normalise_url(case["input"])
    assert normalise_url(once) == once
