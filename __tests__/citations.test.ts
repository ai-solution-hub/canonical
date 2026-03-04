import { describe, it, expect } from 'vitest';
import {
  extractCitedResponse,
  deduplicateCitations,
  countUniqueSources,
} from '@/lib/citations';
import type Anthropic from '@anthropic-ai/sdk';
import type { CitationEntry } from '@/types/bid-metadata';

const mockContent = [
  { id: 'uuid-1', title: 'Data Encryption Policy', content: 'We use AES-256...' },
  { id: 'uuid-2', title: 'Security FAQ', content: 'TLS 1.3 is used...' },
];

describe('extractCitedResponse', () => {
  it('extracts text from response content blocks', () => {
    const mockResponse = {
      content: [{ type: 'text' as const, text: 'Hello world' }],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.text).toBe('Hello world');
    expect(result.citations).toHaveLength(0);
  });

  it('concatenates multiple text blocks', () => {
    const mockResponse = {
      content: [
        { type: 'text' as const, text: 'Part 1 ' },
        { type: 'text' as const, text: 'Part 2' },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.text).toBe('Part 1 Part 2');
  });

  it('extracts search_result_location citations', () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: 'We use AES-256 encryption',
          citations: [
            {
              type: 'search_result_location',
              source: '/item/uuid-1',
              title: 'Data Encryption Policy',
              cited_text: 'We use AES-256 encryption for all data at rest',
              search_result_index: 0,
              start_block_index: 0,
              end_block_index: 0,
            },
          ],
        },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe('uuid-1');
    expect(result.citations[0].source_title).toBe('Data Encryption Policy');
    expect(result.citations[0].cited_text).toBe(
      'We use AES-256 encryption for all data at rest',
    );
    expect(result.citations[0].source_index).toBe(0);
  });

  it('maps search_result_index to correct content item', () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: 'TLS 1.3 is used',
          citations: [
            {
              type: 'search_result_location',
              source: '/item/uuid-2',
              title: 'Security FAQ',
              cited_text: 'TLS 1.3 is used for all communications',
              search_result_index: 1,
              start_block_index: 0,
              end_block_index: 0,
            },
          ],
        },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.citations[0].source_id).toBe('uuid-2');
  });

  it('handles citations with out-of-range index gracefully', () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: 'Some text',
          citations: [
            {
              type: 'search_result_location',
              source: '/item/unknown',
              title: null,
              cited_text: 'cited text',
              search_result_index: 99,
              start_block_index: 0,
              end_block_index: 0,
            },
          ],
        },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe('');
  });

  it('ignores non-search_result_location citation types', () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: 'Some text',
          citations: [{ type: 'char_location', cited_text: 'something' }],
        },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.citations).toHaveLength(0);
  });

  it('preserves source_url from citation source field', () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: 'Cited text',
          citations: [
            {
              type: 'search_result_location',
              source: '/item/uuid-1',
              title: 'Data Encryption Policy',
              cited_text: 'We use AES-256',
              search_result_index: 0,
              start_block_index: 2,
              end_block_index: 5,
            },
          ],
        },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.citations[0].source_url).toBe('/item/uuid-1');
    expect(result.citations[0].start_block_index).toBe(2);
    expect(result.citations[0].end_block_index).toBe(5);
  });

  it('handles empty content array', () => {
    const mockResponse = {
      content: [],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.text).toBe('');
    expect(result.citations).toHaveLength(0);
  });

  it('handles text block without citations property', () => {
    const mockResponse = {
      content: [{ type: 'text' as const, text: 'No citations here' }],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.text).toBe('No citations here');
    expect(result.citations).toHaveLength(0);
  });

  it('extracts multiple citations from a single text block', () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: 'We use AES-256 and TLS 1.3',
          citations: [
            {
              type: 'search_result_location',
              source: '/item/uuid-1',
              title: 'Data Encryption Policy',
              cited_text: 'AES-256',
              search_result_index: 0,
              start_block_index: 0,
              end_block_index: 0,
            },
            {
              type: 'search_result_location',
              source: '/item/uuid-2',
              title: 'Security FAQ',
              cited_text: 'TLS 1.3',
              search_result_index: 1,
              start_block_index: 0,
              end_block_index: 0,
            },
          ],
        },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].source_id).toBe('uuid-1');
    expect(result.citations[1].source_id).toBe('uuid-2');
  });

  it('uses source title when citation title is null', () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: 'Some text',
          citations: [
            {
              type: 'search_result_location',
              source: '/item/uuid-1',
              title: null,
              cited_text: 'cited',
              search_result_index: 0,
              start_block_index: 0,
              end_block_index: 0,
            },
          ],
        },
      ],
    } as unknown as Anthropic.Message;

    const result = extractCitedResponse(mockResponse, mockContent);
    // When citation title is null, falls back to sourceItem.title
    expect(result.citations[0].source_title).toBe('Data Encryption Policy');
  });
});

describe('deduplicateCitations', () => {
  it('removes duplicate citations by source_id', () => {
    const citations: CitationEntry[] = [
      {
        cited_text: 'text 1',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: 'Title 1',
        source_url: '/item/uuid-1',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: 'text 2',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: 'Title 1',
        source_url: '/item/uuid-1',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: 'text 3',
        source_index: 1,
        source_id: 'uuid-2',
        source_title: 'Title 2',
        source_url: '/item/uuid-2',
        start_block_index: 0,
        end_block_index: 0,
      },
    ];

    const result = deduplicateCitations(citations);
    expect(result).toHaveLength(2);
    expect(result[0].source_id).toBe('uuid-1');
    expect(result[1].source_id).toBe('uuid-2');
  });

  it('keeps the first occurrence when deduplicating', () => {
    const citations: CitationEntry[] = [
      {
        cited_text: 'first occurrence',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: 'Title 1',
        source_url: '/item/uuid-1',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: 'second occurrence',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: 'Title 1',
        source_url: '/item/uuid-1',
        start_block_index: 1,
        end_block_index: 1,
      },
    ];

    const result = deduplicateCitations(citations);
    expect(result).toHaveLength(1);
    expect(result[0].cited_text).toBe('first occurrence');
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateCitations([])).toHaveLength(0);
  });

  it('returns same array when all sources are unique', () => {
    const citations: CitationEntry[] = [
      {
        cited_text: 'text 1',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: 'Title 1',
        source_url: '/item/uuid-1',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: 'text 2',
        source_index: 1,
        source_id: 'uuid-2',
        source_title: 'Title 2',
        source_url: '/item/uuid-2',
        start_block_index: 0,
        end_block_index: 0,
      },
    ];

    const result = deduplicateCitations(citations);
    expect(result).toHaveLength(2);
  });
});

describe('countUniqueSources', () => {
  it('counts unique source IDs', () => {
    const citations: CitationEntry[] = [
      {
        cited_text: '',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: '',
        source_url: '',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: '',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: '',
        source_url: '',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: '',
        source_index: 1,
        source_id: 'uuid-2',
        source_title: '',
        source_url: '',
        start_block_index: 0,
        end_block_index: 0,
      },
    ];

    expect(countUniqueSources(citations)).toBe(2);
  });

  it('returns 0 for empty array', () => {
    expect(countUniqueSources([])).toBe(0);
  });

  it('returns 1 for single citation', () => {
    const citations: CitationEntry[] = [
      {
        cited_text: 'text',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: 'Title',
        source_url: '/item/uuid-1',
        start_block_index: 0,
        end_block_index: 0,
      },
    ];

    expect(countUniqueSources(citations)).toBe(1);
  });

  it('counts all unique when no duplicates', () => {
    const citations: CitationEntry[] = [
      {
        cited_text: '',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: '',
        source_url: '',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: '',
        source_index: 1,
        source_id: 'uuid-2',
        source_title: '',
        source_url: '',
        start_block_index: 0,
        end_block_index: 0,
      },
      {
        cited_text: '',
        source_index: 2,
        source_id: 'uuid-3',
        source_title: '',
        source_url: '',
        start_block_index: 0,
        end_block_index: 0,
      },
    ];

    expect(countUniqueSources(citations)).toBe(3);
  });
});
