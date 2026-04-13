"""Tests for config.py env-var override behaviour.

Verifies that AI_-prefixed env vars are preferred, legacy unprefixed vars
are accepted as fallback, and defaults are correct when neither is set.
Uses monkeypatch + importlib.reload because config.py evaluates env vars
at module import time.
"""

import importlib
import os
import sys

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _reload_config():
    from kb_pipeline import config
    return importlib.reload(config)


def test_classification_model_defaults_to_opus(monkeypatch):
    monkeypatch.delenv("AI_CLASSIFICATION_MODEL", raising=False)
    monkeypatch.delenv("CLASSIFICATION_MODEL", raising=False)
    config = _reload_config()
    assert config.CLASSIFICATION_MODEL == "claude-opus-4-6"


def test_classification_model_prefers_prefixed(monkeypatch):
    monkeypatch.setenv("AI_CLASSIFICATION_MODEL", "claude-test-prefixed")
    monkeypatch.setenv("CLASSIFICATION_MODEL", "claude-test-legacy")
    config = _reload_config()
    assert config.CLASSIFICATION_MODEL == "claude-test-prefixed"


def test_classification_model_falls_back_to_legacy(monkeypatch):
    monkeypatch.delenv("AI_CLASSIFICATION_MODEL", raising=False)
    monkeypatch.setenv("CLASSIFICATION_MODEL", "claude-test-legacy")
    config = _reload_config()
    assert config.CLASSIFICATION_MODEL == "claude-test-legacy"


def test_embedding_model_default(monkeypatch):
    monkeypatch.delenv("AI_EMBEDDING_MODEL", raising=False)
    monkeypatch.delenv("EMBEDDING_MODEL", raising=False)
    config = _reload_config()
    assert config.EMBEDDING_MODEL == "text-embedding-3-large"


def test_embedding_model_prefers_prefixed(monkeypatch):
    monkeypatch.setenv("AI_EMBEDDING_MODEL", "text-embedding-test")
    monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-legacy")
    config = _reload_config()
    assert config.EMBEDDING_MODEL == "text-embedding-test"


def test_embedding_model_falls_back_to_legacy(monkeypatch):
    monkeypatch.delenv("AI_EMBEDDING_MODEL", raising=False)
    monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-legacy")
    config = _reload_config()
    assert config.EMBEDDING_MODEL == "text-embedding-legacy"


def test_embedding_dims_default(monkeypatch):
    monkeypatch.delenv("AI_EMBEDDING_DIMS", raising=False)
    monkeypatch.delenv("EMBEDDING_DIMS", raising=False)
    config = _reload_config()
    assert config.EMBEDDING_DIMS == 1024
    assert isinstance(config.EMBEDDING_DIMS, int)


def test_embedding_dims_parses_int(monkeypatch):
    monkeypatch.setenv("AI_EMBEDDING_DIMS", "512")
    monkeypatch.delenv("EMBEDDING_DIMS", raising=False)
    config = _reload_config()
    assert config.EMBEDDING_DIMS == 512
    assert isinstance(config.EMBEDDING_DIMS, int)


def test_embedding_dims_prefers_prefixed(monkeypatch):
    monkeypatch.setenv("AI_EMBEDDING_DIMS", "256")
    monkeypatch.setenv("EMBEDDING_DIMS", "768")
    config = _reload_config()
    assert config.EMBEDDING_DIMS == 256


def test_embedding_dims_falls_back_to_legacy(monkeypatch):
    monkeypatch.delenv("AI_EMBEDDING_DIMS", raising=False)
    monkeypatch.setenv("EMBEDDING_DIMS", "768")
    config = _reload_config()
    assert config.EMBEDDING_DIMS == 768
