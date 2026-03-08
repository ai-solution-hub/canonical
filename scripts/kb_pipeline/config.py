"""Shared configuration for Knowledge Hub pipeline."""

import logging
import os

logger = logging.getLogger(__name__)

# Derive PROJECT_ROOT from file location: config.py is at scripts/kb_pipeline/config.py
# So PROJECT_ROOT = dirname(dirname(dirname(abspath(__file__))))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ENV_PATH = os.path.join(PROJECT_ROOT, ".env")
PROMPT_PATH = os.path.join(PROJECT_ROOT, "docs", "reference", "classification-prompt.md")
SUPABASE_URL = None  # loaded from .env via get_env()

# Models
CLASSIFICATION_MODEL = "claude-opus-4-6"
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMS = 1024

# Pricing (per token)
OPUS_INPUT_PRICE = 5.00 / 1_000_000
OPUS_OUTPUT_PRICE = 25.00 / 1_000_000
OPUS_CACHE_WRITE_PRICE = 6.25 / 1_000_000
OPUS_CACHE_READ_PRICE = 0.50 / 1_000_000
EMBEDDING_PRICE = 0.13 / 1_000_000

# Dedup thresholds
DEDUP_SIMILARITY_THRESHOLD = 0.90

# Quality thresholds
SHORT_CONTENT_THRESHOLD = 100  # chars
LOW_CONFIDENCE_THRESHOLD = 0.60


def load_env():
    """Parse .env file, return dict."""
    env = {}
    with open(ENV_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
    return env


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
    """Get Supabase URL from .env."""
    env = get_env()
    return env.get('SUPABASE_URL', '')


def get_supabase_secret_key():
    """Get Supabase service_role key from .env (bypasses RLS)."""
    env = get_env()
    return env.get('SUPABASE_SECRET_KEY', '')


def get_supabase_publishable_key():
    """Get Supabase anon/publishable key from .env."""
    env = get_env()
    return env.get('SUPABASE_PUBLISHABLE_KEY', '')
