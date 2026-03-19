import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestUrl, ingestText, createQAPair } from '@/lib/copilotkit/ingestion-actions';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ingestUrl', () => {
  it('returns result with id and title on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'item-1',
        title: 'Test Article',
        content_type: 'article',
        primary_domain: 'security',
        warnings: [],
      }),
    });

    const result = await ingestUrl({ url: 'https://example.com/article' });
    expect(result).toEqual({
      id: 'item-1',
      title: 'Test Article',
      contentType: 'article',
      domain: 'security',
      warnings: [],
      duplicateMatches: undefined,
    });
  });

  it('returns error for invalid URL format', async () => {
    const result = await ingestUrl({ url: 'not-a-url' });
    expect(result).toEqual({ error: expect.stringContaining('Invalid URL') });
  });

  it('returns error when API returns non-200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Rate limited' }),
    });

    const result = await ingestUrl({ url: 'https://example.com' });
    expect(result).toEqual({ error: 'Rate limited' });
  });

  it('passes content_type and user_tags through', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'x', title: 'X', warnings: [] }),
    });

    await ingestUrl({
      url: 'https://example.com',
      content_type: 'blog',
      user_tags: ['imported'],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content_type).toBe('blog');
    expect(body.user_tags).toEqual(['imported']);
  });

  it('handles url_already_exists response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url_already_exists: true,
        existing_item: { id: 'existing-1', title: 'Existing Item' },
      }),
    });

    const result = await ingestUrl({ url: 'https://example.com' });
    expect(result).toEqual({ error: expect.stringContaining('already been imported') });
  });
});

describe('ingestText', () => {
  it('returns result with id and title on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'item-2',
        title: 'My Article',
        content_type: 'article',
        warnings: [],
      }),
    });

    const result = await ingestText({
      title: 'My Article',
      content: 'Some content here.',
    });
    expect(result).toEqual({
      id: 'item-2',
      title: 'My Article',
      contentType: 'article',
      warnings: [],
      duplicateMatches: undefined,
    });
  });

  it('returns error when title is missing', async () => {
    const result = await ingestText({ title: '', content: 'Some content' });
    expect(result).toEqual({ error: 'Title is required.' });
  });

  it('returns error when content is empty', async () => {
    const result = await ingestText({ title: 'Test', content: '  ' });
    expect(result).toEqual({ error: 'Content is required.' });
  });

  it('passes all optional fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'x', title: 'X', warnings: [] }),
    });

    await ingestText({
      title: 'Test',
      content: 'Content',
      content_type: 'policy',
      primary_domain: 'compliance',
      user_tags: ['tag1'],
      source_url: 'https://example.com',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content_type).toBe('policy');
    expect(body.primary_domain).toBe('compliance');
    expect(body.user_tags).toEqual(['tag1']);
    expect(body.source_url).toBe('https://example.com');
    expect(body.auto_classify).toBe(true);
    expect(body.auto_summarise).toBe(true);
    expect(body.auto_embed).toBe(true);
  });

  it('returns duplicate_matches when API reports them', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'item-3',
        title: 'Dup Test',
        content_type: 'article',
        warnings: ['Near-duplicate found'],
        duplicate_matches: [{ id: 'dup-1', title: 'Similar Item', similarity: 0.95 }],
      }),
    });

    const result = await ingestText({ title: 'Dup Test', content: 'Content' });
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.duplicateMatches).toHaveLength(1);
      expect(result.duplicateMatches![0].similarity).toBe(0.95);
    }
  });
});

describe('createQAPair', () => {
  it('returns result with id on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'qa-1',
        title: 'What is GDPR?',
        content_type: 'q_a_pair',
        warnings: [],
      }),
    });

    const result = await createQAPair({
      question: 'What is GDPR?',
      answer: 'The General Data Protection Regulation...',
    });
    expect(result).toEqual({
      id: 'qa-1',
      title: 'What is GDPR?',
      contentType: 'q_a_pair',
      warnings: [],
      duplicateMatches: undefined,
    });
  });

  it('sends content_type as q_a_pair', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'x', title: 'X', warnings: [] }),
    });

    await createQAPair({ question: 'Q?', answer: 'A.' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content_type).toBe('q_a_pair');
  });

  it('sets brief to the question text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'x', title: 'X', warnings: [] }),
    });

    await createQAPair({ question: 'What is ISO 27001?', answer: 'A standard...' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.brief).toBe('What is ISO 27001?');
    expect(body.content).toBe('A standard...');
  });

  it('returns error when question is empty', async () => {
    const result = await createQAPair({ question: '', answer: 'An answer' });
    expect(result).toEqual({ error: 'Question is required.' });
  });

  it('returns error when answer is empty', async () => {
    const result = await createQAPair({ question: 'A question?', answer: '' });
    expect(result).toEqual({ error: 'Answer is required.' });
  });

  it('truncates long questions for the title', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'x', title: 'X', warnings: [] }),
    });

    const longQuestion = 'A'.repeat(250);
    await createQAPair({ question: longQuestion, answer: 'Answer' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.title.length).toBeLessThanOrEqual(200);
    expect(body.title.endsWith('...')).toBe(true);
  });
});
