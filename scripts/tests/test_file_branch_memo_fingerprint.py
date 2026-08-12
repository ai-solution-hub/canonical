"""bl-239 / id-400 — REAL-ENGINE probe: file-branch memo fingerprint vs op_id.

Settles how the FILE branch (`bound_ingest_file` → `ingest_file` in
`scripts/cocoindex_pipeline/flow.py`) behaves across walks. {75.17}/bl-239
originally proved the OUTER component memo was busted every walk (the per-walk
`flow_op_id` kwarg was a memo input) while the inner LLM seams stayed safe.
id-400 (D-397-A Option C, TRIAGE §3.1) ruled that channel a DEFECT and moved
the run context onto the ContextKey-provided `FlowRunContext` holder
(`flow_context.py`) — invisible to the memo fingerprint by construction
(`detect_change=False`; memo fingerprints cover function inputs + code only).

VERDICT (proven below on the installed cocoindex engine) — the S265 semantic
("a no-op re-ingest does NOT re-stamp op_id; a full_reprocess DOES") is
RESTORED by the context channel, pinned in four parts:

1. PRODUCTION SHAPE, unchanged bytes: with the run context OFF the kwargs the
   outer `@coco.fn(memo=True)` component memo-HITS across walks — the body
   (and therefore every row re-stamp) is SKIPPED for unchanged items, and the
   per-walk cost drops to scan+skip.

2. PRODUCTION SHAPE, changed bytes: the item re-runs and the body observes the
   CURRENT walk's op_id through `resolve_flow_run_context()` — changed items
   stamp the walk that materially changed them.

3. PRODUCTION SHAPE, full_reprocess: `update_blocking(full_reprocess=True)`
   bypasses memos — every item re-runs and observes the current walk's op_id
   (the "full_reprocess DOES re-stamp" half of S265).

4. ENGINE CONTROLS (mechanism attribution, unchanged from bl-239): a memo'd
   component with a STABLE op_id kwarg memo-hits across walks, and a memo'd
   seam that takes a per-walk op_id as an argument re-burns every walk —
   i.e. args/kwargs ARE fingerprint inputs (`_make_call_canonical` covers
   function identity, version, canonical args, canonical sorted kwargs), so
   the pre-id-400 re-stamp was caused by exactly the kwarg channel, and the
   fix must keep the run context off the signature.

The inner LLM seams (`extract_classification` / `extract_qa_form` /
`extract_entity_mentions`, each `@coco.fn(memo=True)` over `content_text`
only) remain independently safe — unchanged bytes never re-invoke the
Anthropic seam even when the outer body re-runs.

Probe mechanics follow the ID-75.16 precedent
(``test_url_source_engine_consumption.py``): the real engine boots in a
SUBPROCESS (cannot pollute cocoindex's process-global App/env registries or
leak ``_LoopRunner`` daemon threads into the shared pytest process) and the
module self-skips where the engine cannot boot (EPERM under sandboxed agent
worktrees — bl-218). Production fidelity: the CASE-A probe drives the REAL
``convert_binary_to_markdown`` adapter and the REAL three extractors (their
production memo identities — module, qualname, signature) through the real
``localfs.walk_dir(live=True)`` → ``mount_each`` → consecutive
``update_blocking(live=False)`` walks (the exact ``POST /walk`` posture,
server.py / bl-221), resolving the run context through the REAL
``flow_context.FlowRunContext`` holder provided under the REAL
``FLOW_RUN_CTX`` ContextKey by a probe lifespan — with ONLY the
``_anthropic_message`` SDK seam replaced by a counting stub returning valid
extraction JSON — no Anthropic API calls, no Supabase writes, no B1
interaction.
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
# CASE A — PRODUCTION SEAMS, id-400 shape. The outer probe component mirrors
# the memo-relevant shape of `ingest_file` exactly: `@coco.fn(memo=True)` with
# the item value as its ONLY per-item argument and the run context resolved
# INSIDE the body via the REAL `flow_context.resolve_flow_run_context()`
# (holder provided under the REAL FLOW_RUN_CTX ContextKey by a probe
# lifespan, exactly as `kh_pipeline_lifespan` provides it). Inside it the
# REAL Stage-2 adapter and the REAL three Stage-3 extractors run as plain
# awaits, exactly as `_ingest_content_branch` drives them. Only
# `_anthropic_message` (the SDK seam INSIDE the extractors' memo boundary) is
# replaced with a counting stub — replacing the extractors themselves would
# change the very memo identities under test.
#
# Walk plan (all on the SAME App in the SAME process — the production /walk
# posture): walk1 (op A, fresh corpus) → walk2 (op B, unchanged bytes) →
# walk3 (op C, CHANGED bytes) → walk4 (op D, unchanged bytes,
# full_reprocess=True). Repo root arrives via argv[1] (no str.format — the
# sources are full of dict braces).
_PRODUCTION_SEAMS_PROBE_SRC = """
import json, os, sys, tempfile, uuid
from types import SimpleNamespace

os.environ["COCOINDEX_DB"] = tempfile.mkdtemp(prefix="bl239-lmdb-")
# Dummy key: anthropic.AsyncAnthropic() requires SOME key at construction;
# the stub below guarantees no request is ever issued.
os.environ["ANTHROPIC_API_KEY"] = "test-key-never-used"
sys.path.insert(0, sys.argv[1])

import cocoindex as coco
from scripts.cocoindex_pipeline import extraction, flow_context, prompts
from scripts.cocoindex_pipeline._coco_api import localfs
from scripts.cocoindex_pipeline.adapters import convert_binary_to_markdown

SRC = tempfile.mkdtemp(prefix="bl239-corpus-")
DOC = os.path.join(SRC, "doc.md")
with open(DOC, "w") as f:
    f.write("# Stable doc\\n\\nUnchanged content across walks.\\n")

SEAM = {"classification": 0, "qa_form": 0, "entity_mentions": 0}
OUTER = {"runs": 0, "observed_op_ids": [], "channels": []}


class _FakeMessage:
    def __init__(self, text):
        self.content = [SimpleNamespace(text=text)]
        self.stop_reason = "end_turn"


# Valid stub payloads: content_type is sourced live from the SAME frozenset
# the REAL extractor validates against (extraction._VALID_CONTENT_TYPES —
# the DR-130 inline constant), so a stay-set change cannot re-stale this
# stub (bl-417). `sorted(...)[0]` is an arbitrary-but-deterministic
# in-set pick. form_type / primary_domain are plain literals: DR-130
# deleted their gates, so any string validates. Entity mentions return an
# empty list (valid, and keeps the probe off the per-mention paths).
_CONTENT_TYPE = sorted(extraction._VALID_CONTENT_TYPES)[0]
_FORM_TYPE = "questionnaire"
_PRIMARY_DOMAIN = "security"
_CLS = json.dumps({
    "extraction_kind": "classification", "content_type": _CONTENT_TYPE,
    "primary_domain": _PRIMARY_DOMAIN, "classification_confidence": 0.9,
})
_QA = json.dumps({
    "extraction_kind": "q_a_form",
    "form_metadata": {"form_type": _FORM_TYPE, "form_format": "md"},
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


# The id-400 production channel: the probe lifespan provides the REAL module
# singleton under the REAL ContextKey, exactly as `kh_pipeline_lifespan` does.
@coco.lifespan
async def probe_lifespan(builder):
    builder.provide(flow_context.FLOW_RUN_CTX, flow_context.FLOW_RUN_CONTEXT)
    yield


@coco.fn(memo=True)
async def probe_ingest_file(file) -> None:
    OUTER["runs"] += 1
    # Record WHICH channel resolved (context vs singleton fallback) plus the
    # op_id observed — the assertions bind on the op_id; the channel is
    # reported for forensics.
    try:
        holder = coco.use_context(flow_context.FLOW_RUN_CTX)
        OUTER["channels"].append("context")
    except Exception:
        holder = None
        OUTER["channels"].append("fallback")
    ctx = flow_context.resolve_flow_run_context()
    OUTER["observed_op_ids"].append(str(ctx.op_id))
    content_text = await convert_binary_to_markdown(file)
    # id-389 AC-3: the extractors take the lane's LLM identity as their second
    # positional (the memo-key tier discriminator). Production routes this
    # through `extraction.extract_with_memo_self_heal`, which resolves it per
    # call; the probe resolves it the same way so the memo identities under
    # test stay the production ones. It is CONSTANT across these four walks
    # (no env flip between them), so it cannot perturb the op_id semantics
    # this probe measures.
    identity = extraction.resolve_llm_identity()
    await extraction.extract_classification(content_text, identity)
    await extraction.extract_qa_form(content_text, identity)
    await extraction.extract_entity_mentions(content_text, identity)


async def bound_probe_ingest_file(file):
    return await probe_ingest_file(file)


async def probe_main():
    src = localfs.walk_dir(SRC, live=True, recursive=True)
    handle = await coco.mount_each(
        coco.component_subpath("probe_ingest"), bound_probe_ingest_file, src.items()
    )
    await handle.ready()


app = coco.App(coco.AppConfig(name="bl239_probe"), probe_main)

OPS = [uuid.uuid4() for _ in range(4)]


def _snapshot():
    return {
        "outer_runs": OUTER["runs"],
        "observed_op_ids": list(OUTER["observed_op_ids"]),
        "channels": list(OUTER["channels"]),
        **dict(SEAM),
    }


# walk 1 — op A, fresh corpus.
flow_context.FLOW_RUN_CONTEXT.begin_flow_run(op_id=OPS[0])
app.update_blocking(live=False)
walk1 = _snapshot()

# walk 2 — op B, unchanged bytes: the id-400 memo-HIT walk.
flow_context.FLOW_RUN_CONTEXT.begin_flow_run(op_id=OPS[1])
app.update_blocking(live=False)
walk2 = _snapshot()

# walk 3 — op C, CHANGED bytes: the item must re-run and observe op C.
with open(DOC, "w") as f:
    f.write("# Stable doc\\n\\nMaterially changed content for walk 3.\\n")
flow_context.FLOW_RUN_CONTEXT.begin_flow_run(op_id=OPS[2])
app.update_blocking(live=False)
walk3 = _snapshot()

# walk 4 — op D, unchanged bytes, FULL REPROCESS: memos bypassed, re-run.
flow_context.FLOW_RUN_CONTEXT.begin_flow_run(op_id=OPS[3])
app.update_blocking(live=False, full_reprocess=True)
walk4 = _snapshot()

print(json.dumps({
    "ops": [str(o) for o in OPS],
    "walk1": walk1, "walk2": walk2, "walk3": walk3, "walk4": walk4,
}))
"""

# CASE B/C — MECHANISM CONTROLS, decoupled from the production seams (the
# ID-75.16 CASE-C precedent: isolate the engine contract so a CASE-A failure
# can be attributed).
#   - probe_stable:  outer memo'd component with a CONSTANT op_id kwarg across
#     both walks -> the outer memo must HIT on walk 2 (component skipped),
#     proving FileLike/arg fingerprints are stable across walks.
#   - probe_keyed:   a memo'd seam that TAKES the per-walk op_id as an
#     argument -> must RE-BURN on walk 2, proving (a) args/kwargs participate
#     in the memo fingerprint across walks (the pre-id-400 defect mechanism —
#     the reason the run context must stay OFF the production signature) and
#     (b) this harness detects re-burn (no false green).
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
    # memo key. This is the pre-id-400 production defect shape.
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
# results are cached so the tests share two subprocess executions.
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
        timeout=300,
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
    """The id-400 file-branch op_id/memo contract, executable (S265 restored)."""

    def test_walk1_invokes_each_extraction_seam_once_and_observes_op_a(self):
        # Baseline: the first walk over one staged file drives the outer body
        # once, each of the three production extractors through the SDK seam
        # exactly once, and the body observes walk 1's op_id through the
        # id-400 run-context channel.
        result = _run_probe(_PRODUCTION_SEAMS_PROBE_SRC)
        counts = result["walk1"]
        assert counts["outer_runs"] == 1
        assert (
            counts["classification"] == 1
            and counts["qa_form"] == 1
            and counts["entity_mentions"] == 1
        ), f"walk-1 baseline drifted: {counts!r}"
        assert counts["observed_op_ids"] == [result["ops"][0]], (
            "the component body must observe walk 1's op_id via "
            f"resolve_flow_run_context() ({result!r})"
        )

    def test_unchanged_file_second_walk_memo_hits_no_restamp_no_reburn(self):
        # THE id-400 verdict (S265 restored). Walk 2 (fresh op_id published on
        # the holder, unchanged bytes):
        #   - outer_runs STILL 1 — the per-item component memo-HIT across
        #     walks, because the run context no longer enters the fingerprint
        #     (D-397-A Option C). The body — and therefore every row
        #     re-stamp — was SKIPPED: a no-op re-ingest does NOT re-stamp.
        #   - all three extraction seams STILL 1 — no LLM re-burn.
        result = _run_probe(_PRODUCTION_SEAMS_PROBE_SRC)
        walk2 = result["walk2"]
        assert walk2["outer_runs"] == 1, (
            "id-400 REGRESSION: the outer component re-ran on an unchanged "
            "walk — something re-entered the memo fingerprint (a run-context "
            f"kwarg back on the signature?) ({result!r})"
        )
        assert (
            walk2["classification"] == 1
            and walk2["qa_form"] == 1
            and walk2["entity_mentions"] == 1
        ), (
            "RE-BURN DETECTED on the file branch: an unchanged source file "
            f"re-invoked the LLM extraction seam on a second walk ({result!r})"
        )

    def test_changed_bytes_third_walk_reruns_and_observes_current_op_id(self):
        # Changed bytes → memo miss → the body re-runs and observes walk 3's
        # op_id: rows are stamped by the walk that MATERIALLY changed them
        # (the other half of the S265 semantic). The seams re-burn once —
        # the content is genuinely new.
        result = _run_probe(_PRODUCTION_SEAMS_PROBE_SRC)
        walk3 = result["walk3"]
        assert walk3["outer_runs"] == 2, (
            f"changed bytes must re-run the component ({result!r})"
        )
        assert walk3["observed_op_ids"][-1] == result["ops"][2], (
            "the re-run body must observe the CURRENT walk's op_id via the "
            f"run-context holder ({result!r})"
        )
        assert (
            walk3["classification"] == 2
            and walk3["qa_form"] == 2
            and walk3["entity_mentions"] == 2
        ), f"changed content must re-extract exactly once ({result!r})"

    def test_full_reprocess_fourth_walk_bypasses_memo_and_restamps(self):
        # `full_reprocess=True` bypasses memos: the unchanged item re-runs and
        # observes walk 4's op_id — "a full_reprocess run DOES re-stamp every
        # row" (S265, id-28/PRODUCT.md:84).
        result = _run_probe(_PRODUCTION_SEAMS_PROBE_SRC)
        walk4 = result["walk4"]
        assert walk4["outer_runs"] == 3, (
            f"full_reprocess must re-run the component ({result!r})"
        )
        assert walk4["observed_op_ids"][-1] == result["ops"][3], (
            f"full_reprocess re-run must observe the current op_id ({result!r})"
        )

    def test_stable_op_id_outer_memo_hits_across_walks(self):
        # Attribution control: hold the op_id kwarg CONSTANT across walks and
        # the outer component memo HITS (body skipped on walk 2) — FileLike /
        # arg fingerprints are stable across walks.
        result = _run_probe(_CONTROLS_PROBE_SRC)
        assert result["walk1"]["outer_stable"] == 1
        assert result["walk2"]["outer_stable"] == 1, (
            "outer memo no longer hits across walks under a STABLE op_id — "
            "the FileLike/arg fingerprint is unstable and EVERY memo boundary "
            f"in the file branch needs re-audit ({result!r})"
        )

    def test_op_id_keyed_seam_would_reburn_every_walk(self):
        # Negative control (the pre-id-400 production defect): a memo'd seam
        # whose own key includes the per-walk op_id re-runs on walk 2. Proves
        # the harness CAN detect re-burn, and pins why the run context must
        # stay OFF the memoised signatures: args/kwargs ARE fingerprint
        # inputs (memo_fingerprint.py _make_call_canonical).
        result = _run_probe(_CONTROLS_PROBE_SRC)
        assert result["walk1"]["seam_keyed"] == 1
        assert result["walk2"]["seam_keyed"] == 2, (
            "engine contract changed: a per-walk arg in a seam's memo key no "
            f"longer forces a re-run ({result!r}) — re-verify the "
            "fingerprint-covers-args contract (memo_fingerprint.py "
            "_make_call_canonical)"
        )
