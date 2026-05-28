"""Regression guard for the cocoindex Cloud Run Service manifests (ID-49.9).

Two distinct boot-required databases are wired into every cocoindex sidecar
manifest, and BOTH must be present in the applied revision or the worker
thread crashes before `/health` can report it dead (audit
`docs/audits/cocoindex-state-db-connection-crash-2026-05-26.md`):

  - `COCOINDEX_DB_DSN` — the KH-owned asyncpg pool (Postgres), mounted via
    `secretKeyRef` (landed ID-49.8 / commit c33a0fa3).
  - `COCOINDEX_DB`     — the cocoindex ENGINE's internal LMDB state-store
    *filesystem path* (NOT a Postgres DSN). `environment.start_sync()` raises
    `ValueError("Environment settings must provide Settings.db_path (or set
    COCOINDEX_DB environment variable)")` when unset — the next boot crash
    after the DSN fix (ID-49.9).

This guard asserts, per manifest, that the LMDB wiring is intact:

  1. a `COCOINDEX_DB` plain-value env var pointing at the in-memory volume
     mount path,
  2. a `volumeMount` that mounts a named volume at the directory containing
     that path,
  3. a `volumes` entry for that same name backed by an in-memory `emptyDir`
     (`medium: Memory`) — a real local FS so LMDB's mmap + file locking work
     (GCS FUSE does not support these, hence emptyDir not a Cloud Storage
     volume).

It parses the YAML (PyYAML is a pipeline dependency) and checks every file,
so a future edit that drops the env var on one tenant/env but not the others
fails loudly. It does NOT boot the engine — the db_path-resolution behaviour
of cocoindex itself is covered by the local-verification check recorded in the
ID-49.9 journal; this guard is purely about the deployed manifest shape.

Note: the kpf-cocoindex tenant (staging-kpf-cocoindex.yaml /
prod-kpf-cocoindex.yaml) was deprecated and its manifests deleted at S274
(commit aec96058), so this guard now covers the example-client tenant only.
"""

from __future__ import annotations

import pathlib

import pytest
import yaml

# Repo root = three levels up from this file (scripts/tests/<this>.py).
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST_DIR = REPO_ROOT / "cloudrun" / "services"

COCOINDEX_MANIFESTS = [
    # kpf-cocoindex manifests were deleted at S274 (commit aec96058); the example-client
    # tenant is the only cocoindex sidecar deployed across staging + prod.
    "staging-example-client-cocoindex.yaml",
    "prod-example-client-cocoindex.yaml",
]


def _load_manifest(filename: str) -> dict:
    path = MANIFEST_DIR / filename
    assert path.exists(), f"cocoindex manifest missing on disk: {path}"
    with path.open(encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    assert isinstance(doc, dict), f"{filename} did not parse as a YAML mapping"
    return doc


def _container(doc: dict) -> dict:
    """Return the single cocoindex container spec from a Service manifest."""
    containers = doc["spec"]["template"]["spec"]["containers"]
    assert len(containers) == 1, (
        f"expected exactly one container in the cocoindex manifest, "
        f"found {len(containers)}"
    )
    return containers[0]


def _env_map(container: dict) -> dict[str, dict]:
    """Map env-var name -> the full entry dict (so callers can inspect
    `value` vs `valueFrom`)."""
    return {entry["name"]: entry for entry in container.get("env", [])}


# ──────────────────────────────────────────────────────────────────────────
# COCOINDEX_DB env var (LMDB path) — present, plain value, points at a mount
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("filename", COCOINDEX_MANIFESTS)
def test_manifest_declares_cocoindex_db_env(filename: str) -> None:
    """Every cocoindex manifest declares a plain-value COCOINDEX_DB env var."""
    env = _env_map(_container(_load_manifest(filename)))
    assert "COCOINDEX_DB" in env, (
        f"{filename} is missing the COCOINDEX_DB env var — the cocoindex engine "
        f"will raise ValueError at boot (audit §2)"
    )
    entry = env["COCOINDEX_DB"]
    assert "value" in entry, (
        f"{filename}: COCOINDEX_DB must be a plain `value:` (an LMDB filesystem "
        f"path), not a secretKeyRef"
    )
    assert "valueFrom" not in entry, (
        f"{filename}: COCOINDEX_DB is a path, not a secret — it must not use "
        f"valueFrom/secretKeyRef"
    )
    assert entry["value"].strip(), f"{filename}: COCOINDEX_DB value is empty"


@pytest.mark.parametrize("filename", COCOINDEX_MANIFESTS)
def test_manifest_keeps_cocoindex_db_dsn_secret(filename: str) -> None:
    """COCOINDEX_DB_DSN (the Postgres pool, ID-49.8) must remain a secretKeyRef
    alongside the new LMDB path — the two boot-required DBs are distinct and
    BOTH must be in the applied revision."""
    env = _env_map(_container(_load_manifest(filename)))
    assert "COCOINDEX_DB_DSN" in env, (
        f"{filename} lost the COCOINDEX_DB_DSN secret (ID-49.8 regression)"
    )
    secret_ref = env["COCOINDEX_DB_DSN"].get("valueFrom", {}).get("secretKeyRef")
    assert secret_ref and secret_ref.get("name") == "COCOINDEX_DB_DSN", (
        f"{filename}: COCOINDEX_DB_DSN must stay mounted via secretKeyRef"
    )


# ──────────────────────────────────────────────────────────────────────────
# In-memory volume + volumeMount backing the LMDB path
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("filename", COCOINDEX_MANIFESTS)
def test_manifest_mounts_in_memory_volume_for_lmdb(filename: str) -> None:
    """The COCOINDEX_DB path is backed by a named in-memory emptyDir volume,
    mounted at a directory that contains the path — so LMDB writes land on a
    real (tmpfs) local FS, not a missing dir."""
    doc = _load_manifest(filename)
    container = _container(doc)
    env = _env_map(container)

    db_path = env["COCOINDEX_DB"]["value"]

    # 1. A volumeMount whose mountPath is a prefix of the COCOINDEX_DB path.
    volume_mounts = container.get("volumeMounts", [])
    assert volume_mounts, f"{filename}: container declares no volumeMounts"
    covering = [
        vm
        for vm in volume_mounts
        if db_path == vm["mountPath"]
        or db_path.startswith(vm["mountPath"].rstrip("/") + "/")
    ]
    assert covering, (
        f"{filename}: no volumeMount covers the COCOINDEX_DB path {db_path!r} "
        f"(mounts: {[vm['mountPath'] for vm in volume_mounts]})"
    )
    mount = covering[0]
    volume_name = mount["name"]

    # 2. A matching volumes entry backed by an in-memory emptyDir.
    volumes = doc["spec"]["template"]["spec"].get("volumes", [])
    assert volumes, f"{filename}: spec.template.spec declares no volumes"
    matching = [v for v in volumes if v["name"] == volume_name]
    assert matching, (
        f"{filename}: volumeMount references volume {volume_name!r} but no such "
        f"volume is declared (volumes: {[v['name'] for v in volumes]})"
    )
    volume = matching[0]
    empty_dir = volume.get("emptyDir")
    assert empty_dir is not None, (
        f"{filename}: volume {volume_name!r} must be an emptyDir (LMDB needs a "
        f"real local FS — GCS FUSE is mmap/lock-incompatible)"
    )
    assert empty_dir.get("medium") == "Memory", (
        f"{filename}: volume {volume_name!r} emptyDir must be RAM-backed "
        f"(medium: Memory) for a gen2 in-memory volume"
    )
    assert empty_dir.get("sizeLimit"), (
        f"{filename}: in-memory emptyDir {volume_name!r} must set a sizeLimit so "
        f"it counts safely against the container memory budget"
    )
