"""Shared configuration for Knowledge Hub pipeline."""

import os
import re

# Derive PROJECT_ROOT from file location: config.py is at scripts/kb_pipeline/config.py
# So PROJECT_ROOT = dirname(dirname(dirname(abspath(__file__))))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ENV_PATH = os.path.join(PROJECT_ROOT, ".env")
PROMPT_PATH = os.path.join(PROJECT_ROOT, "docs", "reference", "classification-prompt.md")
SUPABASE_URL = "https://ngsxwlaeybexlgsurnhy.supabase.co"

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

# Reddit link/image posts have content like "[Linked: https://...]" — these are
# expected to be short, so skip the short_content quality flag for them.
_REDDIT_LINK_PATTERN = re.compile(r"^\[Linked: https?://")


def is_reddit_link_post(platform: str, content: str) -> bool:
    """Return True if this is a Reddit link/image post with expected short content."""
    return platform == "reddit" and bool(_REDDIT_LINK_PATTERN.match(content))


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


def get_env():
    global _env
    if _env is None:
        _env = load_env()
    return _env


def get_system_prompt():
    global _system_prompt
    if _system_prompt is None:
        _system_prompt = load_system_prompt()
    return _system_prompt
