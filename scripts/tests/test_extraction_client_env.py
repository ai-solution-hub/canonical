"""Behaviour tests for `_extraction_async_client()` — the empty-string
credential-env guard (id-389 tier extension).

The property under test: the id-389 LLM-tier mechanism selects mock /
OpenRouter / real Anthropic purely via `ANTHROPIC_BASE_URL` /
`ANTHROPIC_AUTH_TOKEN` env, which makes compose `${VAR:-}` passthrough the
deploy shape — and the SDK treats an EMPTY string as set (`base_url=""`
beats the api.anthropic.com default; `auth_token=""` emits a broken
`Authorization: Bearer ` header — both empirically proven on
anthropic==0.79.0, 2026-07-28). The factory must treat empty as unset so a
blank-rendered var degrades to the SDK default instead of killing the lane.
"""

from __future__ import annotations

import os

import pytest

from scripts.cocoindex_pipeline import extraction


@pytest.fixture(autouse=True)
def _restore_credential_env(monkeypatch):
    # monkeypatch snapshots and restores the three vars around each test.
    for var in ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    yield


def test_empty_base_url_falls_back_to_sdk_default(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    client = extraction._extraction_async_client()
    assert str(client.base_url).startswith("https://api.anthropic.com")


def test_empty_auth_token_sends_no_bearer_header(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    client = extraction._extraction_async_client()
    assert "Authorization" not in client.auth_headers


def test_real_values_pass_through(monkeypatch):
    # The tier mechanism itself: a real BASE_URL redirects, a real
    # AUTH_TOKEN rides as Bearer.
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "http://mockllm-platform-staging:8080")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "or-token")
    client = extraction._extraction_async_client()
    assert str(client.base_url).startswith("http://mockllm-platform-staging:8080")
    assert client.auth_headers["Authorization"] == "Bearer or-token"


def test_empty_values_are_deleted_from_process_env(monkeypatch):
    # Later bare constructions elsewhere in the process must not re-read
    # the poisoned empties.
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    extraction._extraction_async_client()
    assert "ANTHROPIC_BASE_URL" not in os.environ
    assert "ANTHROPIC_AUTH_TOKEN" not in os.environ
    assert os.environ["ANTHROPIC_API_KEY"] == "test-key"
