#!/usr/bin/env python3
"""
Compute BERTScore for candidate/reference summary pairs.

Accepts JSON on stdin: [{"candidate": "...", "reference": "..."}, ...]
Outputs JSON on stdout: [{"precision": 0.9, "recall": 0.88, "f1": 0.89}, ...]

Uses microsoft/deberta-base-mnli (86M params, CPU-friendly).
Model is cached after first download (~350MB).

Usage:
    echo '[{"candidate": "summary", "reference": "ref"}]' | python3 scripts/compute-bertscore.py
"""

import json
import sys


def main():
    try:
        raw = sys.stdin.read()
        pairs = json.loads(raw)

        if not isinstance(pairs, list) or len(pairs) == 0:
            json.dump({"error": "Expected non-empty JSON array on stdin"}, sys.stdout)
            sys.exit(1)

        candidates = []
        references = []
        for pair in pairs:
            candidates.append(pair.get("candidate", ""))
            references.append(pair.get("reference", ""))

        # Import here so startup errors are caught gracefully
        from bert_score import score  # noqa: E402

        # Use deberta-base-mnli: lightweight, CPU-friendly, sufficient for regression detection
        P, R, F1 = score(
            candidates,
            references,
            model_type="microsoft/deberta-base-mnli",
            lang="en",
            verbose=False,
            rescale_with_baseline=True,
        )

        results = []
        for i in range(len(candidates)):
            results.append(
                {
                    "precision": round(P[i].item(), 4),
                    "recall": round(R[i].item(), 4),
                    "f1": round(F1[i].item(), 4),
                }
            )

        json.dump(results, sys.stdout)

    except json.JSONDecodeError as e:
        json.dump({"error": f"Invalid JSON input: {str(e)}"}, sys.stdout)
        sys.exit(1)
    except ImportError as e:
        json.dump(
            {"error": f"Missing dependency: {str(e)}. Run: pip install bert-score"},
            sys.stdout,
        )
        sys.exit(1)
    except Exception as e:
        json.dump({"error": f"BERTScore computation failed: {str(e)}"}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
