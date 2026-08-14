"""Marker registration scoped to `pipeline/tests/produce/` only."""

from __future__ import annotations


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: engine-/DB-dependent path, skipped by default (id-465 HARD LIMITS)",
    )
