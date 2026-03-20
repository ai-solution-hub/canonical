// ---------------------------------------------------------------------------
// Ingestion action handlers — pure functions with no React dependencies
// ---------------------------------------------------------------------------

/**
 * Layer suggestion from the inference engine, returned by API routes.
 */
interface LayerSuggestion {
  suggestedLayer: string;
  reason: string;
  confidence: string;
}

/**
 * Result shape returned by ingestion handlers.
 */
export interface IngestResult {
  id: string;
  title: string;
  contentType?: string;
  domain?: string;
  warnings: string[];
  duplicateMatches?: Array<{ id: string; title: string; similarity: number }>;
  /** Layer suggestion (auto-applied by CopilotKit actions) */
  suggestedLayer?: string;
}

/**
 * Ingest a URL into the Knowledge Base.
 *
 * Calls POST /api/ingest/url which extracts content, classifies,
 * embeds, and summarises automatically.
 */
export async function ingestUrl(params: {
  url: string;
  content_type?: string;
  user_tags?: string[];
}): Promise<IngestResult | { error: string }> {
  // Basic client-side URL validation
  try {
    new URL(params.url);
  } catch {
    return { error: 'Invalid URL format. Please provide a valid web address.' };
  }

  const response = await fetch('/api/ingest/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: params.url,
      ...(params.content_type && { content_type: params.content_type }),
      ...(params.user_tags?.length && { user_tags: params.user_tags }),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { error: data.error ?? 'Failed to ingest URL' };
  }

  // Handle soft URL-already-exists warning
  if (data.url_already_exists) {
    return {
      error: `This URL has already been imported as "${data.existing_item?.title}". The existing item ID is ${data.existing_item?.id}.`,
    };
  }

  // Auto-apply layer suggestion (CopilotKit = auto-assign, not suggest-and-confirm)
  const suggestion: LayerSuggestion | undefined = data.suggested_layer;
  if (suggestion?.suggestedLayer && data.id) {
    try {
      await fetch(`/api/items/${data.id}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layer: suggestion.suggestedLayer }),
      });
    } catch {
      // Non-fatal — item is still usable without layer update
    }
  }

  return {
    id: data.id,
    title: data.title,
    contentType: data.content_type,
    domain: data.primary_domain,
    warnings: data.warnings ?? [],
    duplicateMatches: data.duplicate_matches,
    suggestedLayer: suggestion?.suggestedLayer,
  };
}

/**
 * Ingest pasted text content into the Knowledge Base.
 *
 * Calls POST /api/items with auto-classify, auto-summarise, and
 * auto-embed enabled.
 */
export async function ingestText(params: {
  title: string;
  content: string;
  content_type?: string;
  primary_domain?: string;
  user_tags?: string[];
  source_url?: string;
}): Promise<IngestResult | { error: string }> {
  if (!params.title?.trim()) {
    return { error: 'Title is required.' };
  }
  if (!params.content?.trim()) {
    return { error: 'Content is required.' };
  }
  if (params.title.length > 500) {
    return { error: 'Title must be 500 characters or fewer.' };
  }

  const response = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params.title.trim(),
      content: params.content.trim(),
      content_type: params.content_type ?? 'article',
      auto_classify: true,
      auto_summarise: true,
      auto_embed: true,
      ingestion_source: 'copilotkit',
      ...(params.primary_domain && { primary_domain: params.primary_domain }),
      ...(params.user_tags?.length && { user_tags: params.user_tags }),
      ...(params.source_url && { source_url: params.source_url }),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { error: data.error ?? 'Failed to create content item' };
  }

  // Auto-apply layer suggestion (CopilotKit = auto-assign)
  const textSuggestion: LayerSuggestion | undefined = data.suggested_layer;
  if (textSuggestion?.suggestedLayer && data.id) {
    try {
      await fetch(`/api/items/${data.id}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layer: textSuggestion.suggestedLayer }),
      });
    } catch {
      // Non-fatal
    }
  }

  return {
    id: data.id,
    title: data.title,
    contentType: data.content_type,
    warnings: data.warnings ?? [],
    duplicateMatches: data.duplicate_matches,
    suggestedLayer: textSuggestion?.suggestedLayer,
  };
}

/**
 * Create a Q&A pair in the Knowledge Base.
 *
 * Formats as content_type 'q_a_pair' with brief = question,
 * content = answer.
 */
export async function createQAPair(params: {
  question: string;
  answer: string;
  primary_domain?: string;
  user_tags?: string[];
}): Promise<IngestResult | { error: string }> {
  if (!params.question?.trim()) {
    return { error: 'Question is required.' };
  }
  if (!params.answer?.trim()) {
    return { error: 'Answer is required.' };
  }

  // Title from truncated question
  const title = params.question.length > 200
    ? params.question.slice(0, 197) + '...'
    : params.question;

  const response = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      content: params.answer.trim(),
      brief: params.question.trim(),
      content_type: 'q_a_pair',
      auto_classify: true,
      auto_summarise: true,
      auto_embed: true,
      ingestion_source: 'copilotkit',
      ...(params.primary_domain && { primary_domain: params.primary_domain }),
      ...(params.user_tags?.length && { user_tags: params.user_tags }),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { error: data.error ?? 'Failed to create Q&A pair' };
  }

  // Auto-apply layer suggestion (CopilotKit = auto-assign)
  const qaSuggestion: LayerSuggestion | undefined = data.suggested_layer;
  if (qaSuggestion?.suggestedLayer && data.id) {
    try {
      await fetch(`/api/items/${data.id}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layer: qaSuggestion.suggestedLayer }),
      });
    } catch {
      // Non-fatal
    }
  }

  return {
    id: data.id,
    title: data.title,
    contentType: 'q_a_pair',
    warnings: data.warnings ?? [],
    duplicateMatches: data.duplicate_matches,
    suggestedLayer: qaSuggestion?.suggestedLayer,
  };
}
