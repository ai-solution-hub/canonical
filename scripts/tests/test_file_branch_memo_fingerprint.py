"""bl-239 — REAL-ENGINE probe: file-branch memo fingerprint vs per-walk op_id.

Settles whether the FILE branch (`bound_ingest_file` → `ingest_file` in
`scripts/cocoindex_pipeline/flow.py`) re-burns LLM extraction on every hourly
walk. {75.17} proved the URL branch safe; S321 steady-state evidence (hourly
walks 4-5 s, zero LLM events on B1 logs) was strong but informal for the file
branch. This probe is the executable record.

VERDICT (proven below on the installed ``cocoindex==1.0.3`` engine):
**re-burn SAFE** — with the mechanism pinned in three parts:

1. The OUTER component memo IS busted every walk. `app_main` mints a fresh
   ``run_op_id = uuid.uuid4()`` per update pass (flow.py:2901) and
   ``bound_ingest_file`` threads it as ``flow_op_id=`` into the
   ``@coco.fn(memo=True)`` ``ingest_file`` (flow.py:3106-3119). The engine's
   fingerprint covers ALL args + kwargs (``_make_call_canonical`` in
   ``cocoindex/_internal/memo_fingerprint.py:333`` — function identity,
   version, canonical args, canonical SORTED KWARGS), so the per-item
   component body RE-RUNS for every file on every walk. This is the {75.17}
   correction to the Inv-11 "skipped on unchanged source bytes" framing,
   now confirmed on the file-branch shape too.

2. The LLM seams are NOT busted. The three Path-A extractors
   (``extract_classification`` / ``extract_qa_form`` /
   ``extract_entity_mentions``, extraction.py:981-1062) are each
   ``@coco.fn(memo=True)`` over ``content_text: str`` ONLY — no op_id, no
   counters, no targets cross their memo boundary (bl-220 / ID-74 keeps the
   stamp fields post-memo). Unchanged bytes → identical ``content_text`` →
   memo HIT on walk 2 → zero Anthropic invocations. The 4-5 s walks observed
   in S321 are the re-running outer bodies (memo lookups + declare_row
   re-upserts), not LLM work.

3. The protection is attributable to the seam SIGNATURES, not to engine
   grace: the negative control shows a memo'd seam that takes the per-walk
   op_id as an argument re-burns on every walk, and the stable-op_id control
   shows the outer component memo-HITS across walks when the op_id is held
   constant — i.e. the walk-2 outer re-run in the production shape is caused
   by exactly the ``flow_op_id`` kwarg.

Probe mechanics follow the ID-75.16 precedent
(``test_url_source_engine_consumption.py``): the real engine boots in a
SUBPROCESS (cannot pollute cocoindex's process-global App/env registries or
leak ``_LoopRunner`` daemon threads into the shared pytest process) and the
module self-skips where the engine cannot boot (EPERM under sandboxed agent
worktrees — bl-218). Production fidelity: the CASE-A probe drives the REAL
``convert_binary_to_markdown`` adapter and the REAL three extractors (their
production memo identities — module, qualname, signature) through the real
``localfs.walk_dir(live=True)`` → ``mount_each`` → two consecutive
``update_blocking(live=False)`` walks (the exact ``POST /walk`` posture,
server.py / bl-221), with ONLY the ``_anthropic_message`` SDK seam replaced
by a counting stub returning valid extraction JSON — no Anthropic API calls,
no Supabase writes, no B1 interaction.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]

# ──────────────────────────────────────────────────────────────────────────
# Engine-availability guard (bl-218 shape, module-local copy)
# ──────────────────────────────────────────────────────────────────────────

_COCOINDEX_ENGINE_AVAILABLE: bool | None = None

_ENGINE_PROBE_SRC = """
import sys, tempfile, os
try:
    from cocoindex._internal import setting
    from cocoindex._internal.environment import Environment
    d = tempfile.mkdtemp(prefix='bl239-engine-probe-')
    Environment(settings=setting.Settings(db_path=os.path.join(d, 'lmdb')))
except Exception as exc:
    sys.stderr.write('ENGINE_BOOT_FAILED:%r\\n' % (exc,))
    sys.exit(3)
sys.exit(0)
"""


def _cocoindex_engine_available() -> bool:
    """True iff the cocoindex Rust engine can boot here (see bl-218).

    NB: under the agent sandbox the engine raises a Rust-side
    ``RuntimeError('Operation not permitted (os error 1)')`` — NOT a Python
    ``PermissionError`` — so the guard catches ``Exception`` broadly.
    """
    global _COCOINDEX_ENGINE_AVAILABLE
    if _COCOINDEX_ENGINE_AVAILABLE is not None:
        return _COCOINDEX_ENGINE_AVAILABLE

    try:
        proc = subprocess.run(
            [sys.executable, "-c", _ENGINE_PROBE_SRC],
            capture_output=True,
            timeout=60,
        )
        _COCOINDEX_ENGINE_AVAILABLE = proc.returncode == 0
    except (OSError, subprocess.SubprocessError):
        _COCOINDEX_ENGINE_AVAILABLE = False
    return _COCOINDEX_ENGINE_AVAILABLE


# ──────────────────────────────────────────────────────────────────────────
# Probe sources (run in a subprocess; print a JSON dict of per-walk counts)
# ──────────────────────────────────────────────────────────────────────────
#
# Each probe stages ONE unchanged .md file (the passthrough conversion path —
# no docling), runs TWO consecutive `update_blocking(live=False)` walks on the
# SAME App in the SAME process (the production /walk posture: one long-lived
# B1 process, hourly bearer-gated POST /walk), and snapshots invocation
# counters after each walk. Repo root arrives via argv[1] (no str.format —
# the sources are full of dict braces).

# CASE A — PRODUCTION SEAMS. The outer probe component mirrors the
# memo-relevant shape of `ingest_file` exactly: `@coco.fn(memo=True)` with the
# item value first and the per-walk run context threaded as a `flow_op_id=`
# kwarg via a NAMED closure (the ID-66.19 `bound_ingest_file` pattern —
# `functools.partial` is engine-incompatible). Inside it the REAL Stage-2
# adapter and the REAL three Stage-3 extractors run as plain awaits, exactly
# as `_ingest_content_branch` drives them. Only `_anthropic_message` (the SDK
# seam INSIDE the extractors' memo boundary) is replaced with a counting stub
# — replacing the extractors themselves would change the very memo identities
# under test.
_PRODUCTION_SEAMS_PROBE_SRC = """
import json, os, sys, tempfile, uuid
from types import SimpleNamespace

os.environ["COCOINDEX_DB"] = tempfile.mkdtemp(prefix="bl239-lmdb-")
# Dummy key: anthropic.AsyncAnthropic() requires SOME key at construction;
# the stub below guarantees no request is ever issued.
os.environ["ANTHROPIC_API_KEY"] = "test-key-never-used"
sys.path.insert(0, sys.argv[1])

import cocoindex as coco
from scripts.cocoindex_pipeline import extraction, prompts
from scripts.cocoindex_pipeline._coco_api import localfs
from scripts.cocoindex_pipeline.adapters import convert_binary_to_markdown

SRC = tempfile.mkdtemp(prefix="bl239-corpus-")
with open(os.path.join(SRC, "doc.md"), "w") as f:
    f.write("# Stable doc\\n\\nUnchanged content across walks.\\n")

SEAM = {"classification": 0, "qa_form": 0, "entity_mentions": 0}
OUTER = {"runs": 0}


class _FakeMessage:
    def __init__(self, text):
        self.content = [SimpleNamespace(text=text)]
        self.stop_reason = "end_turn"


# Valid stub payloads: content_type/form_type must pass the canonical-taxonomy
# validators ("policy" / "bid" are baseline snapshot values); entity mentions
# return an empty list (valid, and keeps the probe off the per-mention paths).
_CLS = json.dumps({
    "extraction_kind": "classification", "content_type": "policy",
    "primary_domain": "compliance", "classification_confidence": 0.9,
})
_QA = json.dumps({
    "extraction_kind": "q_a_form",
    "form_metadata": {"form_type": "bid", "form_format": "md"},
    "qa_pairs": [],
})


async def _fake_anthropic_message(client, /, **create_kwargs):
    system_text = create_kwargs["system"][0]["text"]
    if system_text == prompts.CLASSIFICATION_PROMPT:
        SEAM["classification"] += 1
        return _FakeMessage(_CLS)
    if system_text == prompts.Q_A_FORM_PROMPT:
        SEAM["qa_form"] += 1
        return _FakeMessage(_QA)
    if system_text == prompts.ENTITY_MENTION_PROMPT:
        SEAM["entity_mentions"] += 1
        return _FakeMessage("[]")
    raise AssertionError("unknown system prompt reached the SDK seam")


# Module-global lookup at call time inside the extractors -> the patch holds
# WITHOUT touching the @coco.fn-wrapped extractors (memo identity preserved).
extraction._anthropic_message = _fake_anthropic_message

OP = {"id": uuid.uuid4()}


@coco.fn(memo=True)
async def probe_ingest_file(file, *, flow_op_id=None) -> None:
    OUTER["runs"] += 1
    content_text = await convert_binary_to_markdown(file)
    await extraction.extract_classification(content_text)
    await extraction.extract_qa_form(content_text)
    await extraction.extract_entity_mentions(content_text)


async def bound_probe_ingest_file(file):
    return await probe_ingest_file(file, flow_op_id=OP["id"])


async def probe_main():
    src = localfs.walk_dir(SRC, live=True, recursive=True)
    handle = await coco.mount_each(
        coco.component_subpath("probe_ingest"), bound_probe_ingest_file, src.items()
    )
    await handle.ready()


app = coco.App(coco.AppConfig(name="bl239_probe"), probe_main)
app.update_blocking(live=False)
walk1 = {"outer_runs": OUTER["runs"], **dict(SEAM)}
OP["id"] = uuid.uuid4()  # app_main mints a FRESH op_id per walk (flow.py:2901)
app.update_blocking(live=False)
walk2 = {"outer_runs": OUTER["runs"], **dict(SEAM)}
print(json.dumps({"walk1": walk1, "walk2": walk2}))
"""

# CASE B/C — MECHANISM CONTROLS, decoupled from the production seams (the
# ID-75.16 CASE-C precedent: isolate the engine contract so a CASE-A failure
# can be attributed).
#   - probe_stable:  outer memo'd component with a CONSTANT op_id across both
#     walks -> the outer memo must HIT on walk 2 (component skipped), proving
#     the production walk-2 re-run is caused by exactly the fresh op_id kwarg.
#   - probe_keyed:   a memo'd seam that TAKES the per-walk op_id as an
#     argument -> must RE-BURN on walk 2, proving (a) args/kwargs participate
#     in the memo fingerprint across walks and (b) this harness detects
#     re-burn (no false green).
_CONTROLS_PROBE_SRC = """
import json, os, sys, tempfile, uuid

os.environ["COCOINDEX_DB"] = tempfile.mkdtemp(prefix="bl239-lmdb-")
sys.path.insert(0, sys.argv[1])

import cocoindex as coco
from scripts.cocoindex_pipeline._coco_api import localfs

SRC = tempfile.mkdtemp(prefix="bl239-corpus-")
with open(os.path.join(SRC, "doc.md"), "w") as f:
    f.write("# Stable doc\\n\\nUnchanged content across walks.\\n")

COUNTS = {"outer_stable": 0, "outer_keyed": 0, "seam_keyed": 0}
OP = {"id": uuid.uuid4()}
STABLE_OP = uuid.uuid4()


@coco.fn(memo=True)
async def keyed_extract(content_text: str, flow_op_id) -> str:
    # ANTIPATTERN under test: a per-walk-variable arg INSIDE the seam's own
    # memo key. This is what the file branch would look like if it were
    # re-burn UNSAFE.
    COUNTS["seam_keyed"] += 1
    return content_text


@coco.fn(memo=True)
async def probe_stable_op(file, *, flow_op_id=None) -> None:
    COUNTS["outer_stable"] += 1


@coco.fn(memo=True)
async def probe_keyed_seam(file, *, flow_op_id=None) -> None:
    COUNTS["outer_keyed"] += 1
    content_text = await file.read_text()
    await keyed_extract(content_text, flow_op_id)


async def bound_stable(file):
    return await probe_stable_op(file, flow_op_id=STABLE_OP)


async def bound_keyed(file):
    return await probe_keyed_seam(file, flow_op_id=OP["id"])


async def probe_main():
    src = localfs.walk_dir(SRC, live=True, recursive=True)
    h1 = await coco.mount_each(
        coco.component_subpath("probe_stable"), bound_stable, src.items()
    )
    src2 = localfs.walk_dir(SRC, live=True, recursive=True)
    h2 = await coco.mount_each(
        coco.component_subpath("probe_keyed"), bound_keyed, src2.items()
    )
    await h1.ready()
    await h2.ready()


app = coco.App(coco.AppConfig(name="bl239_controls"), probe_main)
app.update_blocking(live=False)
walk1 = dict(COUNTS)
OP["id"] = uuid.uuid4()
app.update_blocking(live=False)
walk2 = dict(COUNTS)
print(json.dumps({"walk1": walk1, "walk2": walk2}))
"""

# One subprocess per probe per pytest run (each boots the Rust engine);
# results are cached so the four tests share two subprocess executions.
_PROBE_CACHE: dict[str, dict] = {}


def _run_probe(src: str) -> dict:
    if src in _PROBE_CACHE:
        return _PROBE_CACHE[src]
    with tempfile.NamedTemporaryFile(
        "w", suffix=".py", prefix="bl239-probe-", delete=False
    ) as fh:
        fh.write(src)
        script_path = fh.name
    proc = subprocess.run(
        [sys.executable, script_path, str(_REPO_ROOT)],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=_REPO_ROOT,
    )
    assert proc.returncode == 0, (
        f"engine probe subprocess failed (exit {proc.returncode}):\n{proc.stderr}"
    )
    result = json.loads(proc.stdout.strip().splitlines()[-1])
    _PROBE_CACHE[src] = result
    return result


@pytest.mark.skipif(
    not _cocoindex_engine_available(),
    reason="cocoindex Rust engine cannot boot here (EPERM under sandboxed "
    "worktrees — bl-218); runs in non-sandboxed CI and on dev machines",
)
class TestFileBranchMemoFingerprint:
    """The bl-239 file-branch re-burn verdict, executable."""

    def test_walk1_invokes_each_extraction_seam_once(self):
        # Baseline: the first walk over one staged file drives each of the
        # three production extractors through the SDK seam exactly once —
        # proving the harness counts real seam traffic (no false green from a
        # seam that was never reachable).
        counts = _run_probe(_PRODUCTION_SEAMS_PROBE_SRC)["walk1"]
        assert counts == {
            "outer_runs": 1,
            "classification": 1,
            "qa_form": 1,
            "entity_mentions": 1,
        }, f"walk-1 baseline drifted: {counts!r}"

    def test_unchanged_file_second_walk_does_not_reburn_llm_seams(self):
        # THE bl-239 verdict. Walk 2 (fresh op_id, unchanged bytes):
        #   - outer_runs == 2 — the per-item component RE-RAN, because the
        #     fresh per-walk `flow_op_id` kwarg busts the outer memo
        #     fingerprint ({75.17}, confirmed here on the file-branch shape);
        #   - all three extraction seams STILL == 1 — the extractors'
        #     content_text-only memo keys HIT, so the Anthropic seam is never
        #     re-invoked. Re-burn SAFE.
        result = _run_probe(_PRODUCTION_SEAMS_PROBE_SRC)
        walk2 = result["walk2"]
        assert walk2["outer_runs"] == 2, (
            "engine contract changed: the per-walk flow_op_id kwarg no longer "
            f"busts the outer component memo ({result!r}) — re-verify the "
            "{75.17} fingerprint contract before trusting this verdict"
        )
        assert (
            walk2["classification"] == 1
            and walk2["qa_form"] == 1
            and walk2["entity_mentions"] == 1
        ), (
            "RE-BURN DETECTED on the file branch: an unchanged source file "
            "re-invoked the LLM extraction seam on a second walk — the "
            f"extractor memo fingerprint is NOT stable ({result!r})"
        )

    def test_stable_op_id_outer_memo_hits_across_walks(self):
        # Attribution control: hold the op_id CONSTANT across walks and the
        # outer component memo HITS (body skipped on walk 2) — so the
        # production walk-2 outer re-run is caused by exactly the fresh
        # per-walk op_id kwarg, not by FileLike fingerprint instability.
        result = _run_probe(_CONTROLS_PROBE_SRC)
        assert result["walk1"]["outer_stable"] == 1
        assert result["walk2"]["outer_stable"] == 1, (
            "outer memo no longer hits across walks under a STABLE op_id — "
            "the FileLike/arg fingerprint is unstable and EVERY memo boundary "
            f"in the file branch needs re-audit ({result!r})"
        )

    def test_op_id_keyed_seam_would_reburn_every_walk(self):
        # Negative control (the antipattern bl-239 feared): a memo'd seam
        # whose own key includes the per-walk op_id re-runs on walk 2. Proves
        # the harness CAN detect re-burn, and pins why the production
        # extractors are safe: their signatures admit no per-walk variable.
        result = _run_probe(_CONTROLS_PROBE_SRC)
        assert result["walk1"]["seam_keyed"] == 1
        assert result["walk2"]["seam_keyed"] == 2, (
            "engine contract changed: a per-walk arg in a seam's memo key no "
            f"longer forces a re-run ({result!r}) — re-verify the "
            "fingerprint-covers-args contract (memo_fingerprint.py "
            "_make_call_canonical)"
        )
