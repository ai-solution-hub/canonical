"""Shared configuration for Knowledge Hub pipeline."""

import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Derive PROJECT_ROOT from file location: config.py is at scripts/kb_pipeline/config.py
# So PROJECT_ROOT = dirname(dirname(dirname(abspath(__file__))))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ENV_PATH = os.path.join(PROJECT_ROOT, ".env.local")
PROMPT_PATH = os.path.join(PROJECT_ROOT, "docs", "reference", "classification-prompt.md")
SUPABASE_URL = None  # loaded from .env.local via get_env()

# Load .env.local into os.environ (does not override existing env vars).
# Per WP-S5.2 spec v1.1 §8.1 + §9 D-20=α: Python pipeline reads .env.local
# only — no .env fallback (`.env` is being phased out from dev-side state).
# Production Python pipeline (W4 WP-RUN.1 Railway target) reads Railway env
# vars natively via os.environ; load_dotenv is a no-op when no file present.
load_dotenv(ENV_PATH)

# Models (overridable via env vars — AI_-prefixed names preferred, legacy fallback for one cycle)
CLASSIFICATION_MODEL = (
    os.environ.get("AI_CLASSIFICATION_MODEL")
    or os.environ.get("CLASSIFICATION_MODEL")
    or "claude-opus-4-6"
)
EMBEDDING_MODEL = (
    os.environ.get("AI_EMBEDDING_MODEL")
    or os.environ.get("EMBEDDING_MODEL")
    or "text-embedding-3-large"
)
EMBEDDING_DIMS = int(
    os.environ.get("AI_EMBEDDING_DIMS")
    or os.environ.get("EMBEDDING_DIMS")
    or "1024"
)

# Pricing (per token) — must match lib/ai/pricing.ts
OPUS_INPUT_PRICE = 15.00 / 1_000_000
OPUS_OUTPUT_PRICE = 75.00 / 1_000_000
OPUS_CACHE_WRITE_PRICE = 18.75 / 1_000_000
OPUS_CACHE_READ_PRICE = 1.50 / 1_000_000
EMBEDDING_PRICE = 0.13 / 1_000_000

# Dedup thresholds (overridable via env vars)
DEDUP_SIMILARITY_THRESHOLD = float(os.environ.get("DEDUP_SIMILARITY_THRESHOLD", "0.90"))

# Quality thresholds (overridable via env vars)
SHORT_CONTENT_THRESHOLD = int(os.environ.get("SHORT_CONTENT_THRESHOLD", "100"))  # chars
LOW_CONFIDENCE_THRESHOLD = float(os.environ.get("LOW_CONFIDENCE_THRESHOLD", "0.60"))


def load_env():
    """Return current environment variables as a dict.

    Variables are loaded from .env.local at module import time via
    python-dotenv. This function now simply returns os.environ as a
    dict for backward compatibility with get_env() caching.
    """
    return dict(os.environ)


def load_system_prompt():
    """Load classification prompt."""
    with open(PROMPT_PATH, "r", encoding="utf-8") as f:
        return f.read()


# Lazy-loaded singletons
_env = None
_system_prompt = None
_use_static_taxonomy = False


def set_static_taxonomy(value: bool):
    """Set whether to use static taxonomy from prompt file (skip DB fetch)."""
    global _use_static_taxonomy
    _use_static_taxonomy = value


def get_env():
    global _env
    if _env is None:
        _env = load_env()
    return _env


def _replace_taxonomy_section(prompt, new_section):
    """Replace the marked taxonomy section in the prompt with new content."""
    start_marker = "<!-- TAXONOMY_START -->"
    end_marker = "<!-- TAXONOMY_END -->"
    s = prompt.index(start_marker)
    e = prompt.index(end_marker) + len(end_marker)
    return prompt[:s] + start_marker + "\n" + new_section + "\n" + end_marker + prompt[e:]


def get_system_prompt():
    global _system_prompt
    if _system_prompt is None:
        raw = load_system_prompt()
        if _use_static_taxonomy:
            logger.warning(
                "Using static taxonomy from prompt file — "
                "domain/subtopic drift possible. "
                "Run `bun run sync:taxonomy` to regenerate from DB."
            )
        if not _use_static_taxonomy:
            try:
                from .store import fetch_taxonomy
                from .classify import build_taxonomy_section, set_valid_taxonomy
                domains, subtopics = fetch_taxonomy()
                section = build_taxonomy_section(domains, subtopics)
                raw = _replace_taxonomy_section(raw, section)
                # Cache valid values for post-classification validation
                valid_domain_names = [d['name'] for d in domains]
                valid_subtopic_names = [s['name'] for s in subtopics]
                set_valid_taxonomy(valid_domain_names, valid_subtopic_names)
                logger.info(
                    "Injected DB taxonomy: %d domains, %d subtopics",
                    len(domains), len(subtopics)
                )
            except Exception as e:
                logger.warning("Failed to fetch DB taxonomy, using static: %s", e)
        _system_prompt = raw
    return _system_prompt


def get_supabase_url():
    """Get Supabase URL from .env.local."""
    env = get_env()
    url = env.get('SUPABASE_URL', '')
    if not url:
        raise RuntimeError("SUPABASE_URL not set in .env.local")
    return url


def get_supabase_secret_key():
    """Get Supabase service_role key from .env.local (bypasses RLS)."""
    env = get_env()
    key = env.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY not set in .env.local")
    return key


def get_supabase_anon_key():
    """Get Supabase anon key from .env.local.

    Checks SUPABASE_PUBLISHABLE_KEY first, then falls back to
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY for compatibility with the Next.js
    environment.
    """
    env = get_env()
    key = env.get('SUPABASE_PUBLISHABLE_KEY', '') or env.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    if not key:
        raise RuntimeError("SUPABASE_PUBLISHABLE_KEY not set in .env.local")
    return key
