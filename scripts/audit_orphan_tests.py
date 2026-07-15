#!/usr/bin/env python3
"""Report tests that import local source files which no longer resolve.

This is a review queue, not a deletion tool. It follows static local imports
from Python and TypeScript/JavaScript test files and reports missing targets.
Filename-only heuristics are opt-in because parity, fixture and integration
tests do not always have a one-to-one source file.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path
from typing import Any


SOURCE_EXTENSIONS = (
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".json",
)
TEST_SUFFIXES = (
    ".test.ts",
    ".test.tsx",
    ".spec.ts",
    ".spec.tsx",
    ".test.js",
    ".test.jsx",
    ".spec.js",
    ".spec.jsx",
)
IMPORT_RE = re.compile(
    r"""^\s*(?:import\s+(?:type\s+)?[^;\n]*?\s+from\s+|import\s+|export\s+[^;\n]*?\s+from\s+|(?:const|let|var)\s+\w+\s*=\s*(?:await\s+)?import\s*\(\s*|(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*|(?:vi|jest)\.mock\s*\(\s*)["']([^"']+)["']""",
    re.MULTILINE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repository root (default: the parent of this script)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional JSON output path",
    )
    parser.add_argument(
        "--include-heuristics",
        action="store_true",
        help="Also report test files without a mirrored source filename",
    )
    return parser.parse_args()


def is_test_file(path: Path, root: Path) -> bool:
    relative = path.relative_to(root).as_posix()
    if relative.startswith(("scripts/tests/", "__tests__/", "e2e/tests/")):
        return (path.suffix == ".py" and path.name.startswith("test_")) or any(
            path.name.endswith(suffix) for suffix in TEST_SUFFIXES
        )
    return any(path.name.endswith(suffix) for suffix in TEST_SUFFIXES)


def is_internal_test_path(path: Path, root: Path) -> bool:
    relative = path.relative_to(root).as_posix()
    return relative.startswith(
        (
            "scripts/tests/",
            "__tests__/",
            "tools/ast-dataflow/__tests__/",
        )
    )


def resolve_file(candidate: Path) -> Path | None:
    candidates = [candidate]
    if candidate.suffix not in SOURCE_EXTENSIONS:
        candidates.extend(
            candidate.with_name(candidate.name + ext) for ext in SOURCE_EXTENSIONS
        )
    else:
        candidates.extend(
            candidate.with_suffix(ext)
            for ext in SOURCE_EXTENSIONS
            if ext != candidate.suffix
        )
    candidates.append(candidate / "__init__.py")
    candidates.extend(candidate / f"index{ext}" for ext in SOURCE_EXTENSIONS)
    for path in candidates:
        if path.is_file():
            return path
    return None


def display_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def resolve_ts_import(specifier: str, importer: Path, root: Path) -> Path | None:
    if specifier.startswith("@/"):
        candidate = root / specifier[2:]
    elif specifier.startswith("."):
        candidate = importer.parent / specifier
    else:
        return None
    return resolve_file(candidate)


def candidate_ts_path(specifier: str, importer: Path, root: Path) -> Path | None:
    if specifier.startswith("@/"):
        return root / specifier[2:]
    if specifier.startswith("."):
        return (importer.parent / specifier).resolve()
    return None


def python_module_path(module: str, root: Path) -> Path | None:
    if module.startswith("scripts."):
        return root / Path(*module.split("."))
    if module.startswith("cocoindex_pipeline."):
        return root / "scripts" / Path(*module.split("."))
    if module.startswith("scripts_"):
        return None
    return None


def resolve_python_module(module: str, root: Path) -> Path | None:
    candidate = python_module_path(module, root)
    if candidate is None:
        return None
    return resolve_file(candidate)


def python_imports(path: Path) -> list[tuple[str, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend((alias.name, "import") for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            module = "." * node.level + node.module
            imports.append((module, "from"))
    return imports


def add_missing(
    findings: list[dict[str, Any]],
    *,
    test: Path,
    specifier: str,
    candidate: Path,
    language: str,
    import_kind: str,
) -> None:
    findings.append(
        {
            "confidence": "high",
            "kind": "missing-local-import",
            "language": language,
            "test": test.as_posix(),
            "import": specifier,
            "import_kind": import_kind,
            "candidate": candidate.as_posix(),
        }
    )


def audit_python_test(path: Path, root: Path, findings: list[dict[str, Any]]) -> None:
    try:
        imports = python_imports(path)
    except (OSError, SyntaxError) as error:
        findings.append(
            {
                "confidence": "manual",
                "kind": "test-parse-error",
                "language": "python",
                "test": path.relative_to(root).as_posix(),
                "error": str(error),
            }
        )
        return

    for specifier, import_kind in imports:
        if specifier.startswith("."):
            continue
        candidate = python_module_path(specifier, root)
        if candidate is None:
            continue
        if resolve_python_module(specifier, root) is None:
            add_missing(
                findings,
                test=path.relative_to(root),
                specifier=specifier,
                candidate=candidate.relative_to(root),
                language="python",
                import_kind=import_kind,
            )


def audit_ts_test(path: Path, root: Path, findings: list[dict[str, Any]]) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        findings.append(
            {
                "confidence": "manual",
                "kind": "test-read-error",
                "language": "typescript",
                "test": path.relative_to(root).as_posix(),
                "error": str(error),
            }
        )
        return

    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(
        r"`(?:\\.|[^`])*`",
        lambda match: "\n" * match.group(0).count("\n"),
        text,
        flags=re.DOTALL,
    )
    for match in IMPORT_RE.finditer(text):
        specifier = match.group(1)
        candidate = candidate_ts_path(specifier, path, root)
        if candidate is None or resolve_ts_import(specifier, path, root) is not None:
            continue
        import_kind = (
            "mock"
            if re.search(r"\b(?:vi|jest)\.mock\s*\(", match.group(0))
            else "module"
        )
        add_missing(
            findings,
            test=path.relative_to(root),
            specifier=specifier,
            candidate=Path(display_path(candidate, root)),
            language="typescript",
            import_kind=import_kind,
        )


def heuristic_findings(path: Path, root: Path) -> list[dict[str, Any]]:
    relative = path.relative_to(root)
    if relative.parts[0] == "__tests__":
        source_relative = Path(*relative.parts[1:])
        stem = source_relative.name
        for suffix in TEST_SUFFIXES:
            if stem.endswith(suffix):
                stem = stem[: -len(suffix)]
                break
        source_relative = source_relative.with_name(stem)
        source = resolve_file(root / source_relative)
        if source is not None:
            return []
        return [
            {
                "confidence": "low",
                "kind": "no-mirrored-source",
                "language": "typescript",
                "test": relative.as_posix(),
                "candidate": source_relative.as_posix(),
            }
        ]

    if relative.parts[:2] == ("scripts", "tests") and path.name.startswith("test_"):
        stem = path.stem.removeprefix("test_")
        source_relative = Path("scripts/cocoindex_pipeline") / f"{stem}.py"
        if resolve_file(root / source_relative) is not None:
            return []
        return [
            {
                "confidence": "low",
                "kind": "no-mirrored-source",
                "language": "python",
                "test": relative.as_posix(),
                "candidate": source_relative.as_posix(),
            }
        ]
    return []


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        print(f"Repository root does not exist: {root}", file=sys.stderr)
        return 2

    findings: list[dict[str, Any]] = []
    test_files = sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and not any(part in {"node_modules", ".git", ".next", ".venv"} for part in path.parts)
        and is_test_file(path, root)
    )

    for path in test_files:
        if path.suffix == ".py":
            audit_python_test(path, root, findings)
        elif is_internal_test_path(path, root):
            audit_ts_test(path, root, findings)
        if args.include_heuristics:
            findings.extend(heuristic_findings(path, root))

    deduped = list(
        {
            json.dumps(finding, sort_keys=True): finding for finding in findings
        }.values()
    )
    report = {
        "root": str(root),
        "test_files_scanned": len(test_files),
        "findings": deduped,
        "summary": {
            "missing_local_imports": sum(
                finding["kind"] == "missing-local-import" for finding in deduped
            ),
            "heuristic_candidates": sum(
                finding["kind"] == "no-mirrored-source" for finding in deduped
            ),
            "parse_or_read_errors": sum(
                finding["kind"].endswith("error") for finding in deduped
            ),
        },
    }

    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")

    for finding in deduped:
        if finding["kind"] == "missing-local-import":
            print(
                f"{finding['test']}: missing {finding['import']} "
                f"({finding['candidate']})",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
