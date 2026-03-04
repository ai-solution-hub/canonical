"""Shared AI summary generation using Claude tool-use mode.

Generates multi-level summaries (executive, detailed, takeaways) for content
items. Used by all pipeline scripts: ingest and markdown ingestion.

The summary result dict can be stored directly into content_items.summary_data
(JSONB), with summary['executive'] denormalised to content_items.ai_summary.
"""

import os
from datetime import datetime, timezone

from .config import get_env

# Max content length for summary prompt (matches batch_generate_summaries.ts)
MAX_SUMMARY_CONTENT_LENGTH = 100_000

# Sonnet pricing (per token) for summary cost estimation
SONNET_INPUT_PRICE = 3.0 / 1_000_000
SONNET_OUTPUT_PRICE = 15.0 / 1_000_000


def generate_summary(title: str, content: str, content_type: str,
                     primary_domain: str = "unknown") -> dict | None:
    """Generate a multi-level AI summary using Claude tool-use mode.

    Returns a dict with 'executive', 'detailed', 'takeaways', plus token/cost
    metadata, or None if generation fails.
    """
    try:
        import anthropic
    except ImportError:
        print("  [Summary] WARNING: anthropic package not installed — skipping summary")
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY") or get_env().get("ANTHROPIC_API_KEY")
    if not api_key:
        print("  [Summary] WARNING: ANTHROPIC_API_KEY not set — skipping summary")
        return None

    model = os.environ.get("AI_SUMMARY_MODEL", "claude-sonnet-4-6")

    # Truncate content to avoid excessive token usage
    truncated_content = content[:MAX_SUMMARY_CONTENT_LENGTH] if len(content) > MAX_SUMMARY_CONTENT_LENGTH else content

    is_transcript = content_type in ("transcript", "podcast", "video")

    prompt = f"""You are summarising content for a knowledge base.
Content type: {content_type}
Title: {title}
Domain: {primary_domain}

Rules:
- 3 to 7 takeaways
- Use UK English
- Be specific and factual, not vague
{"- This is a transcript/podcast: capture the speaker's key arguments, viewpoints, and any debates or disagreements between speakers" if is_transcript else "- For articles/posts: focus on the thesis, evidence, and conclusions"}
- The executive summary should be self-contained and informative

Content to summarise:
{truncated_content}"""

    tool_definition = {
        "name": "return_summary",
        "description": "Return the generated summary",
        "input_schema": {
            "type": "object",
            "properties": {
                "executive": {
                    "type": "string",
                    "description": "Single sentence summary (max 150 chars)",
                },
                "detailed": {
                    "type": "string",
                    "description": "2-3 paragraph detailed summary",
                },
                "takeaways": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "3-7 key takeaways",
                },
            },
            "required": ["executive", "detailed", "takeaways"],
        },
    }

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=2000,
            tools=[tool_definition],
            tool_choice={"type": "tool", "name": "return_summary"},
            messages=[{"role": "user", "content": prompt}],
        )

        if response.stop_reason == "max_tokens":
            print("  [Summary] WARNING: Response truncated (max_tokens reached)")
            return None

        # Extract tool use result from response
        tool_result = None
        for block in response.content:
            if block.type == "tool_use" and block.name == "return_summary":
                tool_result = block.input
                break

        if not tool_result:
            print("  [Summary] WARNING: No tool_use block in response")
            return None

        if not tool_result.get("executive") or not tool_result.get("detailed") or not isinstance(tool_result.get("takeaways"), list):
            print("  [Summary] WARNING: Invalid summary structure returned")
            return None

        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0
        cost = (input_tokens * SONNET_INPUT_PRICE) + (output_tokens * SONNET_OUTPUT_PRICE)

        return {
            "executive": tool_result["executive"],
            "detailed": tool_result["detailed"],
            "takeaways": tool_result["takeaways"],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": model,
            "tokens_used": input_tokens + output_tokens,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": cost,
        }

    except Exception as e:
        print(f"  [Summary] ERROR: {e}")
        return None
