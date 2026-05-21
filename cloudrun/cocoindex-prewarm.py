#!/usr/bin/env python3
"""
Docling model pre-warm script — runs at Cloud Build time.

ID-28.6: Cloud Run sidecar Service deploy infra.
Spec: docs/specs/t8-cocoindex/TECH.md §Docling-prewarm + §Image-build

Purpose:
    Trigger Docling's lazy-load of layout-heron + docling-models at image
    build time so model weights are baked into the image layer. This avoids
    a ~7 s cold-start model download on the first live request to the
    kh-cocoindex-pipeline Service.

    The cocoindex Rust engine's LMDB rebuild (~7 s on new volume mount) is
    NOT eliminated by this script — that latency is inherent to the LMDB
    cold-start and is acceptable under the S14 min-instances=1 design
    (Service stays warm between calls).

AGPL boundary note:
    This script uses Docling (MIT licence) only. pullmd (AGPL) is a
    separately-deployed Service and is never imported here.

Cloud Build sandbox note (CLAUDE.md gotcha):
    cocoindex 1.0.3 requires dangerouslyDisableSandbox: true for Rust-engine
    LMDB startup in local dev. This constraint applies to local Claude Code
    dev runs only — Cloud Build operates outside that sandbox.

Usage:
    Invoked at Cloud Build time via GOOGLE_BUILD_SCRIPT env var in
    cloudrun/cloudbuild-cocoindex.yaml build step.

    Can also be run locally (with dangerouslyDisableSandbox: true in Claude
    Code) to verify Docling model download completes successfully:
        python3 cloudrun/cocoindex-prewarm.py
"""

import sys
import os


def prewarm_docling() -> None:
    """Instantiate DocumentConverter to trigger lazy-load of Docling models.

    Docling downloads layout-heron (EfficientNet-based layout detector) and
    docling-models (TableFormer + DocLayNet weights) on first DocumentConverter
    instantiation. The download populates the Hugging Face cache directory
    (~/.cache/huggingface/hub/) which the buildpack bakes into the image layer.

    On subsequent cold-starts (LMDB rebuild only), the models are already
    present in the image filesystem — no network call required.
    """
    print("cocoindex-prewarm: starting Docling model pre-warm...", flush=True)

    try:
        # Import triggers Docling's module-level model registry initialisation.
        from docling.document_converter import DocumentConverter

        print(
            "cocoindex-prewarm: DocumentConverter imported successfully.",
            flush=True,
        )

        # Instantiate to trigger lazy-load of layout-heron + docling-models.
        # No document path required — instantiation alone triggers the download.
        _ = DocumentConverter()

        print(
            "cocoindex-prewarm: Docling models pre-warmed into image layer.",
            flush=True,
        )

    except ImportError as exc:
        # Docling not yet installed — this is expected if requirements.txt has
        # not been applied. Fail loudly so Cloud Build surfaces the issue.
        print(
            f"cocoindex-prewarm: ERROR — Docling not installed: {exc}",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    except Exception as exc:  # noqa: BLE001
        # Model download failures (network, disk space) fail the build so the
        # operator discovers the issue before the image is deployed.
        print(
            f"cocoindex-prewarm: ERROR — Docling model pre-warm failed: {exc}",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)


def main() -> None:
    """Entry point."""
    print(
        "cocoindex-prewarm: build-time Docling pre-warm starting.",
        flush=True,
    )
    print(
        f"cocoindex-prewarm: Python {sys.version}, cwd={os.getcwd()}",
        flush=True,
    )

    prewarm_docling()

    print(
        "cocoindex-prewarm: complete. Docling weights are in the image layer.",
        flush=True,
    )


if __name__ == "__main__":
    main()
