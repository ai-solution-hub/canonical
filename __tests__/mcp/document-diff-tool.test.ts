import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatDocumentDiff,
  type DocumentDiffData,
} from '@/lib/mcp/formatters';
import { generateDocumentDiffReviewPrompt } from '@/lib/claude-prompts';

// ──────────────────────────────────────────
// Hoisted mocks for MCP tool handler tests
// ──────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // Each .from() call needs its own independent chain so different tables
  // can return different results within the same handler invocation.
  function makeChain(
    resolvedValue: { data: unknown; error: unknown } = {
      data: null,
      error: null,
    },
  ) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.filter = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(resolvedValue);
    chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve(resolvedValue),
    );
    return chain;
  }

  const fromMock = vi.fn().mockReturnValue(makeChain());

  const mockSupabaseClient = {
    from: fromMock,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    _makeChain: makeChain,
  };

  return {
    mockSupabaseClient,
    fromMock,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
    makeChain,
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn(),
  MAX_EMBEDDING_CHARS: 24_000,
  getEmbeddingModel: vi.fn().mockReturnValue('text-embedding-3-large'),
  getEmbeddingDimensions: vi.fn().mockReturnValue(1024),
}));
vi.mock('@/lib/ai/classify', () => ({ classifyContent: vi.fn() }));
vi.mock('@/lib/ai/summarise', () => ({ generateSummary: vi.fn() }));

type ToolHandler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<unknown>;

function createMockMcpServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    tools,
    registerTool(
      name: string,
      _config: Record<string, unknown>,
      handler: ToolHandler,
    ) {
      tools[name] = { handler };
    },
    getHandler(name: string): ToolHandler | undefined {
      return tools[name]?.handler;
    },
  };
}

// ──────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────

const fullDiff: DocumentDiffData = {
  old_filename: 'bid-library-v1.docx',
  new_filename: 'bid-library-v2.docx',
  summary: {
    added: 2,
    removed: 1,
    modified: 1,
    unchanged: 3,
    total_old: 5,
    total_new: 6,
  },
  entries: [
    {
      diff_type: 'added',
      new_question: 'Do you hold ISO 27001?',
      new_content: 'Yes, certified since 2023.',
    },
    {
      diff_type: 'added',
      new_question: 'What is your data retention policy?',
      new_content:
        'We retain data for 7 years in line with regulatory requirements.',
    },
    {
      diff_type: 'modified',
      old_question: 'How many employees do you have?',
      new_question: 'How many employees do you have?',
      old_content: '120 full-time employees.',
      new_content: '150 full-time employees across 3 offices.',
      similarity_score: 1.0,
      affected_item: { id: 'item-001', title: 'Employee Count Q&A' },
    },
    {
      diff_type: 'removed',
      old_question: 'Do you have a company car policy?',
      old_content: 'Yes, senior staff are eligible for company vehicles.',
      affected_item: { id: 'item-002', title: 'Company Car Policy' },
    },
    {
      diff_type: 'unchanged',
      old_question: 'What is your company name?',
      old_content: 'Acme Corporation Ltd',
      new_question: 'What is your company name?',
      new_content: 'Acme Corporation Ltd',
      similarity_score: 1.0,
    },
    {
      diff_type: 'unchanged',
      old_question: 'Where is your head office?',
      old_content: 'London, UK',
      new_question: 'Where is your head office?',
      new_content: 'London, UK',
      similarity_score: 1.0,
    },
    {
      diff_type: 'unchanged',
      old_question: 'Year of incorporation?',
      old_content: '2010',
      new_question: 'Year of incorporation?',
      new_content: '2010',
      similarity_score: 1.0,
    },
  ],
};

const emptyDiff: DocumentDiffData = {
  old_filename: 'doc-v1.docx',
  new_filename: 'doc-v2.docx',
  summary: {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: 0,
    total_old: 0,
    total_new: 0,
  },
  entries: [],
};

const addedOnlyDiff: DocumentDiffData = {
  old_filename: 'old.docx',
  new_filename: 'new.docx',
  summary: {
    added: 1,
    removed: 0,
    modified: 0,
    unchanged: 0,
    total_old: 0,
    total_new: 1,
  },
  entries: [
    {
      diff_type: 'added',
      new_question: 'New question?',
      new_content: 'New answer.',
    },
  ],
};

const removedOnlyDiff: DocumentDiffData = {
  old_filename: 'old.docx',
  new_filename: 'new.docx',
  summary: {
    added: 0,
    removed: 1,
    modified: 0,
    unchanged: 0,
    total_old: 1,
    total_new: 0,
  },
  entries: [
    {
      diff_type: 'removed',
      old_question: 'Removed question?',
      old_content: 'Removed answer.',
      affected_item: null,
    },
  ],
};

// ──────────────────────────────────────────
// formatDocumentDiff tests
// ──────────────────────────────────────────

describe('formatDocumentDiff', () => {
  it('produces correct markdown heading with filenames', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain(
      '# Document Diff: bid-library-v1.docx \u2192 bid-library-v2.docx',
    );
  });

  it('includes summary section with correct counts', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('## Summary');
    expect(result).toContain('**Added:** 2 new Q&A pairs');
    expect(result).toContain('**Removed:** 1 Q&A pair');
    expect(result).toContain('**Modified:** 1 Q&A pair changed');
    expect(result).toContain('**Unchanged:** 3 Q&A pairs identical');
  });

  it('renders Added section with correct table structure', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('### Added (2)');
    expect(result).toContain('| # | Question | Answer |');
    expect(result).toContain(
      '| 1 | Do you hold ISO 27001? | Yes, certified since 2023. |',
    );
    expect(result).toContain('| 2 | What is your data retention policy?');
  });

  it('renders Modified section with similarity and affected items', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('### Modified (1)');
    expect(result).toContain(
      '| # | Old Question | New Question | Similarity | Affected KB Item |',
    );
    expect(result).toContain('100%');
    expect(result).toContain('Employee Count Q&A');
  });

  it('renders Removed section with affected items', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('### Removed (1)');
    expect(result).toContain('| # | Question | Answer | Affected KB Item |');
    expect(result).toContain('Do you have a company car policy?');
    expect(result).toContain('Company Car Policy');
  });

  it('handles empty diff with no changes message', () => {
    const result = formatDocumentDiff(emptyDiff);
    expect(result).toContain('# Document Diff: doc-v1.docx \u2192 doc-v2.docx');
    expect(result).toContain(
      'No changes detected between the two document versions.',
    );
    expect(result).not.toContain('### Added');
    expect(result).not.toContain('### Modified');
    expect(result).not.toContain('### Removed');
  });

  it('only shows sections that have entries — Added only', () => {
    const result = formatDocumentDiff(addedOnlyDiff);
    expect(result).toContain('### Added (1)');
    expect(result).not.toContain('### Modified');
    expect(result).not.toContain('### Removed');
  });

  it('only shows sections that have entries — Removed only', () => {
    const result = formatDocumentDiff(removedOnlyDiff);
    expect(result).toContain('### Removed (1)');
    expect(result).not.toContain('### Added');
    expect(result).not.toContain('### Modified');
  });

  it('shows em-dash when no affected item', () => {
    const result = formatDocumentDiff(removedOnlyDiff);
    expect(result).toContain('\u2014');
  });

  it('truncates long content to 200 characters', () => {
    const longContent = 'A'.repeat(300);
    const diff: DocumentDiffData = {
      old_filename: 'a.docx',
      new_filename: 'b.docx',
      summary: {
        added: 1,
        removed: 0,
        modified: 0,
        unchanged: 0,
        total_old: 0,
        total_new: 1,
      },
      entries: [
        {
          diff_type: 'added',
          new_question: longContent,
          new_content: longContent,
        },
      ],
    };

    const result = formatDocumentDiff(diff);
    // The truncate function adds '...' at the end, so max visible is 200 chars
    // Verify the full 300-char string is NOT present
    expect(result).not.toContain(longContent);
    // The truncated version should end with '...'
    expect(result).toContain('...');
  });

  it('handles singular counts correctly in summary', () => {
    const singleDiff: DocumentDiffData = {
      old_filename: 'a.docx',
      new_filename: 'b.docx',
      summary: {
        added: 1,
        removed: 1,
        modified: 1,
        unchanged: 1,
        total_old: 3,
        total_new: 3,
      },
      entries: [
        { diff_type: 'added', new_question: 'Q1?', new_content: 'A1' },
        { diff_type: 'removed', old_question: 'Q2?', old_content: 'A2' },
        {
          diff_type: 'modified',
          old_question: 'Q3?',
          new_question: 'Q3?',
          old_content: 'A3',
          new_content: 'A3b',
          similarity_score: 1.0,
        },
        {
          diff_type: 'unchanged',
          old_question: 'Q4?',
          new_question: 'Q4?',
          old_content: 'A4',
          new_content: 'A4',
          similarity_score: 1.0,
        },
      ],
    };

    const result = formatDocumentDiff(singleDiff);
    expect(result).toContain('1 new Q&A pair');
    expect(result).not.toContain('1 new Q&A pairs');
    expect(result).toContain('1 Q&A pair changed');
    expect(result).toContain('1 Q&A pair identical');
  });

  // ── Full-text mode tests ────────────────────────────────────────────────

  const fullTextDiff: DocumentDiffData = {
    old_filename: 'policy-v1.pdf',
    new_filename: 'policy-v2.pdf',
    diff_mode: 'full_text',
    summary: {
      added: 2,
      removed: 1,
      modified: 1,
      unchanged: 1,
      total_old: 3,
      total_new: 4,
    },
    entries: [
      {
        diff_type: 'added',
        diff_mode: 'full_text',
        new_content: 'New paragraph about data retention requirements.',
      },
      {
        diff_type: 'added',
        diff_mode: 'full_text',
        new_content: 'Additional compliance clause added in section 4.',
      },
      {
        diff_type: 'modified',
        diff_mode: 'full_text',
        old_content: 'Staff must complete training annually.',
        new_content:
          'All staff must complete mandatory training every 12 months.',
      },
      {
        diff_type: 'removed',
        diff_mode: 'full_text',
        old_content: 'Outdated procedure for manual reporting.',
      },
      {
        diff_type: 'unchanged',
        diff_mode: 'full_text',
        old_content: 'Company overview section.',
        new_content: 'Company overview section.',
      },
    ],
  };

  it('uses "blocks" not "Q&A pairs" in full-text mode summary', () => {
    const result = formatDocumentDiff(fullTextDiff);
    expect(result).toContain('blocks');
    expect(result).not.toContain('Q&A pair');
  });

  it('shows "Mode: Full-text diff" for full-text mode', () => {
    const result = formatDocumentDiff(fullTextDiff);
    expect(result).toContain('**Mode:** Full-text diff');
  });

  it('uses "Text block" column headers for full-text added entries', () => {
    const result = formatDocumentDiff(fullTextDiff);
    expect(result).toContain('Text block');
    expect(result).not.toContain('Question | Answer');
  });

  it('renders full-text added entries correctly', () => {
    const result = formatDocumentDiff(fullTextDiff);
    expect(result).toContain(
      'New paragraph about data retention requirements.',
    );
    expect(result).toContain(
      'Additional compliance clause added in section 4.',
    );
  });

  it('renders full-text modified entries with old and new text', () => {
    const result = formatDocumentDiff(fullTextDiff);
    expect(result).toContain('Staff must complete training annually.');
    expect(result).toContain(
      'All staff must complete mandatory training every 12 months.',
    );
  });

  it('Q&A fixtures still produce Q&A-specific language (regression guard)', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('Q&A pair');
    expect(result).toContain('Question');
    expect(result).toContain('Answer');
    expect(result).not.toContain('Mode: Full-text diff');
  });
});

// ──────────────────────────────────────────
// generateDocumentDiffReviewPrompt tests
// ──────────────────────────────────────────

describe('generateDocumentDiffReviewPrompt', () => {
  it('produces correct text for multiple changes and affected items', () => {
    const prompt = generateDocumentDiffReviewPrompt('bid-library.docx', 5, 3);
    expect(prompt.label).toBe('Review document changes');
    expect(prompt.prompt).toContain('"bid-library.docx"');
    expect(prompt.prompt).toContain('There are 5 changes detected');
    expect(prompt.prompt).toContain('affecting 3 KB items');
    expect(prompt.prompt).toContain('review the document changes');
    expect(prompt.prompt).not.toContain('get_document_diff');
    expect(prompt.description).toBe('5 changes, 3 items affected');
    expect(prompt.category).toBe('general');
  });

  it('handles singular change correctly', () => {
    const prompt = generateDocumentDiffReviewPrompt('doc.docx', 1, 0);
    expect(prompt.prompt).toContain('There is 1 change detected');
    expect(prompt.prompt).not.toContain('affecting');
  });

  it('handles singular affected item correctly', () => {
    const prompt = generateDocumentDiffReviewPrompt('doc.docx', 3, 1);
    expect(prompt.prompt).toContain('affecting 1 KB item.');
    // "affecting 1 KB item" not "affecting 1 KB items"
    expect(prompt.prompt).not.toContain('affecting 1 KB items');
  });

  it('omits affected items clause when count is zero', () => {
    const prompt = generateDocumentDiffReviewPrompt('doc.docx', 2, 0);
    expect(prompt.prompt).not.toContain('affecting');
    expect(prompt.prompt).toContain('There are 2 changes detected.');
  });

  it('includes correct description', () => {
    const prompt = generateDocumentDiffReviewPrompt('file.docx', 10, 4);
    expect(prompt.description).toBe('10 changes, 4 items affected');
  });
});

// ──────────────────────────────────────────
// get_document_diff handler — diff_id path
// ──────────────────────────────────────────

describe('get_document_diff handler — diff_id parameter', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createMockMcpServer();

    const { registerContentTools } = await import('@/lib/mcp/tools/content');
    await registerContentTools(server as never);
  });

  const extra = { authInfo: { token: 'test', clientId: 'test', scopes: [] } };

  it('resolves documents via diff_id when provided', async () => {
    const handler = server.getHandler('get_document_diff');
    expect(handler).toBeDefined();

    // Set up mock chain responses per .from() call
    let fromCallCount = 0;
    mocks.fromMock.mockImplementation((table: string) => {
      fromCallCount++;
      if (table === 'source_document_diffs' && fromCallCount === 1) {
        // First call: look up the diff entry by diff_id
        return mocks.makeChain({
          data: {
            old_document_id: 'old-doc-id',
            new_document_id: 'new-doc-id',
          },
          error: null,
        });
      }
      if (table === 'source_documents' && fromCallCount === 2) {
        // Second call: fetch old document filename
        return mocks.makeChain({
          data: { id: 'old-doc-id', filename: 'lib-v1.docx' },
          error: null,
        });
      }
      if (table === 'source_documents' && fromCallCount === 3) {
        // Third call: fetch new document filename
        return mocks.makeChain({
          data: { id: 'new-doc-id', filename: 'lib-v2.docx' },
          error: null,
        });
      }
      if (table === 'source_document_diffs' && fromCallCount === 4) {
        // Fourth call: fetch all diff entries for the pair
        return mocks.makeChain({
          data: [
            {
              diff_type: 'added',
              old_question: null,
              new_question: 'New Q?',
              old_content: null,
              new_content: 'New A.',
              similarity_score: null,
              affected_content_item_id: null,
              status: null,
            },
          ],
          error: null,
        });
      }
      // content_items lookup for affected items (empty)
      return mocks.makeChain({ data: [], error: null });
    });

    const result = (await handler!(
      {
        document_id: '00000000-0000-0000-0000-000000000099',
        diff_id: 'diff-id-123',
      },
      extra,
    )) as { content: { text: string }[]; isError?: boolean };

    // Should have queried source_document_diffs first (not source_documents)
    expect(mocks.fromMock.mock.calls[0][0]).toBe('source_document_diffs');
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('lib-v1.docx');
    expect(result.content[0].text).toContain('lib-v2.docx');
  });

  it('returns error when diff_id is not found', async () => {
    const handler = server.getHandler('get_document_diff');

    mocks.fromMock.mockImplementation(() => {
      return mocks.makeChain({
        data: null,
        error: { message: 'not found' },
      });
    });

    const result = (await handler!(
      {
        document_id: '00000000-0000-0000-0000-000000000099',
        diff_id: 'nonexistent',
      },
      extra,
    )) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Diff entry not found');
  });
});
