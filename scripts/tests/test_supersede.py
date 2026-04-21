"""Tests for supersede.py — shared supersession setter helper.

Mirror of __tests__/lib/supersession/set.test.ts — same matrix so parity is
easy to verify.
"""

from __future__ import annotations

import io
import json
import os
import sys
from unittest.mock import MagicMock, Mock, patch
from urllib.error import HTTPError, URLError

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.supersede import (  # noqa: E402
    SupersessionError,
    set_supersession,
)

MOCK_URL = "https://test.supabase.co"
MOCK_KEY = "test-secret-key"

OLD_ID = "11111111-1111-4111-8111-111111111111"
NEW_ID = "22222222-2222-4222-8222-222222222222"
ACTOR_ID = "33333333-3333-4333-8333-333333333333"

OLD_ROW = {
    "id": OLD_ID,
    "title": "Old item title",
    "superseded_by": None,
    "dedup_status": "suspected_duplicate",
}
NEW_ROW = {
    "id": NEW_ID,
    "title": "New item title",
    "superseded_by": None,
    "dedup_status": "clean",
}
UPDATED_OLD_ROW = {
    "id": OLD_ID,
    "title": "Old item title",
    "superseded_by": NEW_ID,
    "dedup_status": "superseded",
}


@pytest.fixture(autouse=True)
def mock_config():
    with (
        patch("kb_pipeline.supersede.get_supabase_url", return_value=MOCK_URL),
        patch(
            "kb_pipeline.supersede.get_supabase_secret_key", return_value=MOCK_KEY
        ),
    ):
        yield


def _mock_response(body, status: int = 200):
    resp = MagicMock()
    resp.status = status
    encoded = json.dumps(body).encode("utf-8") if body is not None else b""
    resp.read.return_value = encoded
    resp.__enter__ = Mock(return_value=resp)
    resp.__exit__ = Mock(return_value=False)
    return resp


def _make_http_error(code: int = 500, body: str = "error"):
    return HTTPError(
        url=f"{MOCK_URL}/rest/v1/content_items",
        code=code,
        msg="Error",
        hdrs={},
        fp=io.BytesIO(body.encode("utf-8")),
    )


def _urlopen_sequence(*responses):
    """Return a side_effect callable that dispenses responses in order.

    Each response may be:
      * a mock HTTP response (from _mock_response)
      * an HTTPError instance (raised)
      * a URLError instance (raised)
    """
    it = iter(responses)

    def _side_effect(*_args, **_kwargs):
        nxt = next(it)
        if isinstance(nxt, (HTTPError, URLError)):
            raise nxt
        return nxt

    return _side_effect


def test_success_updates_old_row_and_returns_both_snapshots():
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([OLD_ROW]),
            _mock_response([NEW_ROW]),
            _mock_response([UPDATED_OLD_ROW]),
        )

        result = set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    assert result["oldItem"] == UPDATED_OLD_ROW
    assert result["newItem"] == NEW_ROW

    # Validate the PATCH body is correct — check third urlopen call
    patch_call = mock_urlopen.call_args_list[2]
    req = patch_call.args[0]
    body = json.loads(req.data.decode("utf-8"))
    assert body == {"superseded_by": NEW_ID, "dedup_status": "superseded"}
    assert req.get_method() == "PATCH"

    # M2 verifier fix — PATCH URL now selects only the four result columns
    # instead of returning the full row via Prefer: return=representation.
    assert "select=id,title,superseded_by,dedup_status" in req.full_url


def test_success_logs_audit_line_with_actor_and_titles(caplog):
    """L4 verifier fix — assert the [supersession.set] audit line."""
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([OLD_ROW]),
            _mock_response([NEW_ROW]),
            _mock_response([UPDATED_OLD_ROW]),
        )

        with caplog.at_level("INFO", logger="kb_pipeline.supersede"):
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    matching = [
        rec
        for rec in caplog.records
        if rec.name == "kb_pipeline.supersede"
        and "[supersession.set]" in rec.getMessage()
    ]
    assert len(matching) == 1, matching
    msg = matching[0].getMessage()
    assert OLD_ID in msg
    assert NEW_ID in msg
    assert ACTOR_ID in msg
    assert OLD_ROW["title"] in msg
    assert NEW_ROW["title"] in msg


def test_no_audit_line_when_validation_fails(caplog):
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([]),
        )

        with caplog.at_level("INFO", logger="kb_pipeline.supersede"):
            with pytest.raises(SupersessionError):
                set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    matching = [
        rec
        for rec in caplog.records
        if "[supersession.set]" in rec.getMessage()
    ]
    assert matching == []


def test_rejects_same_id_without_any_db_call():
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        with pytest.raises(SupersessionError) as ei:
            set_supersession(OLD_ID, OLD_ID, ACTOR_ID)

    assert ei.value.code == "SAME_ID"
    mock_urlopen.assert_not_called()


def test_rejects_old_not_found():
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([]),  # old row missing
            _mock_response([NEW_ROW]),
        )

        with pytest.raises(SupersessionError) as ei:
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    assert ei.value.code == "OLD_NOT_FOUND"


def test_rejects_new_not_found():
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([OLD_ROW]),
            _mock_response([]),
        )

        with pytest.raises(SupersessionError) as ei:
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    assert ei.value.code == "NEW_NOT_FOUND"


def test_rejects_old_already_superseded():
    pre_superseded_old = {
        **OLD_ROW,
        "superseded_by": "99999999-9999-4999-8999-999999999999",
    }
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([pre_superseded_old]),
            _mock_response([NEW_ROW]),
        )

        with pytest.raises(SupersessionError) as ei:
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    assert ei.value.code == "OLD_ALREADY_SUPERSEDED"
    assert ei.value.context["existing_superseded_by"] == (
        "99999999-9999-4999-8999-999999999999"
    )


def test_rejects_new_already_superseded():
    pre_superseded_new = {
        **NEW_ROW,
        "superseded_by": "88888888-8888-4888-8888-888888888888",
    }
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([OLD_ROW]),
            _mock_response([pre_superseded_new]),
        )

        with pytest.raises(SupersessionError) as ei:
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    assert ei.value.code == "NEW_ALREADY_SUPERSEDED"


def test_raises_runtime_error_on_http_failure_during_fetch():
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _make_http_error(code=500),
        )

        with pytest.raises(RuntimeError):
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)


def test_raises_runtime_error_on_urlerror_during_fetch():
    """M3 verifier fix — URLError (network down) must NOT be treated as OLD_NOT_FOUND."""
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            URLError("Network unreachable"),
        )

        with pytest.raises(RuntimeError) as ei:
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    # Confirm it's not a misrouted SupersessionError.
    assert not isinstance(ei.value, SupersessionError)


def test_raises_runtime_error_on_http_failure_during_update():
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([OLD_ROW]),
            _mock_response([NEW_ROW]),
            _make_http_error(code=500),
        )

        with pytest.raises(RuntimeError):
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)


def test_no_update_when_validation_fails():
    """If OLD_NOT_FOUND fires we short-circuit — never call new-fetch or PATCH."""
    with patch("kb_pipeline.supersede.urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.side_effect = _urlopen_sequence(
            _mock_response([]),
            _mock_response([NEW_ROW]),
            _mock_response([UPDATED_OLD_ROW]),
        )

        with pytest.raises(SupersessionError):
            set_supersession(OLD_ID, NEW_ID, ACTOR_ID)

    # Only the old-row fetch should have happened; no new-row fetch, no PATCH.
    assert mock_urlopen.call_count == 1
    req = mock_urlopen.call_args_list[0].args[0]
    assert req.get_method() == "GET"


def test_rejects_invalid_error_code_construction():
    """Guard against typo'd SupersessionError codes."""
    with pytest.raises(ValueError):
        SupersessionError("NOT_A_REAL_CODE", "oops")
