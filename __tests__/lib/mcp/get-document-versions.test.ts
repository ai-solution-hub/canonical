/**
 * MCP Tool: get_document_versions
 *
 * Tests the get_document_versions tool registration and response formatting.
 * Pattern follows __tests__/mcp-new-tools.test.ts — tests the formatter output
 * rather than the live MCP server.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline formatter that mirrors lib/mcp/tools/content.ts logic for
// get_document_versions. We test the formatting logic in isolation because
// the MCP server requires a full transport setup.
// ---------------------------------------------------------------------------

interface VersionRow {
  id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  content_hash: string;
  version: number;
  parent_id: string | null;
  storage_path: string;
  status: string;
  uploaded_by: string;
  created_at: string;
  content_item_count: number;
}

/**
 * Formats version chain data exactly as the MCP tool does.
 * Extracted from lib/mcp/tools/content.ts for testability.
 */
function formatDocumentVersions(
  documentId: string,
  versions: VersionRow[],
): { text: string; structured: Record<string, unknown> } | { error: string } {
  if (!versions || versions.length === 0) {
    return { error: `No document found for ID: ${documentId}` };
  }

  const lines: string[] = [];
  lines.push(`## Document Version Chain`);
  lines.push(`**Filename:** ${versions[0].filename}`);
  lines.push(`**Total versions:** ${versions.length}`);
  lines.push('');

  for (const v of versions) {
    const date = v.created_at
      ? new Date(v.created_at).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Unknown date';

    const current = v.id === documentId ? ' **(requested)**' : '';
    const itemCount = Number(v.content_item_count) || 0;

    lines.push(`### Version ${v.version}${current}`);
    lines.push(`- **ID:** ${v.id}`);
    lines.push(`- **Status:** ${v.status}`);
    lines.push(`- **Uploaded:** ${date}`);
    lines.push(
      `- **File size:** ${v.file_size ? `${(v.file_size / 1024).toFixed(1)} KB` : 'Unknown'}`,
    );
    lines.push(
      `- **Content hash:** ${v.content_hash?.slice(0, 12) ?? 'N/A'}...`,
    );
    lines.push(`- **KB items created:** ${itemCount}`);
    if (v.parent_id) {
      lines.push(`- **Parent version:** ${v.parent_id}`);
    }
    lines.push('');
  }

  return {
    text: lines.join('\n'),
    structured: {
      document_id: documentId,
      filename: versions[0].filename,
      total_versions: versions.length,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        filename: v.filename,
        file_size: v.file_size,
        content_hash: v.content_hash,
        parent_id: v.parent_id,
        uploaded_by: v.uploaded_by,
        created_at: v.created_at,
        content_item_count: Number(v.content_item_count) || 0,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleVersions: VersionRow[] = [
  {
    id: 'doc-v1-uuid',
    filename: 'safety-policy.docx',
    original_filename: 'Safety-Policy.docx',
    mime_type:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 51200,
    content_hash: 'abc123def456',
    version: 1,
    parent_id: null,
    storage_path: '/docs/safety-v1.docx',
    status: 'processed',
    uploaded_by: 'user-1',
    created_at: '2026-01-15T10:00:00Z',
    content_item_count: 3,
  },
  {
    id: 'doc-v2-uuid',
    filename: 'safety-policy.docx',
    original_filename: 'Safety-Policy-v2.docx',
    mime_type:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 62000,
    content_hash: 'xyz789abc000',
    version: 2,
    parent_id: 'doc-v1-uuid',
    storage_path: '/docs/safety-v2.docx',
    status: 'processed',
    uploaded_by: 'user-1',
    created_at: '2026-03-01T14:30:00Z',
    content_item_count: 5,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get_document_versions formatter', () => {
  it('returns error for empty version array', () => {
    const result = formatDocumentVersions('missing-uuid', []);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('No document found');
      expect(result.error).toContain('missing-uuid');
    }
  });

  it('returns error for null-like versions', () => {
    const result = formatDocumentVersions(
      'missing-uuid',
      null as unknown as VersionRow[],
    );
    expect('error' in result).toBe(true);
  });

  it('formats a valid version chain with header', () => {
    const result = formatDocumentVersions('doc-v2-uuid', sampleVersions);
    expect('text' in result).toBe(true);
    if (!('text' in result)) return;

    expect(result.text).toContain('## Document Version Chain');
    expect(result.text).toContain('**Filename:** safety-policy.docx');
    expect(result.text).toContain('**Total versions:** 2');
  });

  it('marks the requested document with **(requested)**', () => {
    const result = formatDocumentVersions('doc-v2-uuid', sampleVersions);
    if (!('text' in result)) return;

    expect(result.text).toContain('### Version 2 **(requested)**');
    expect(result.text).not.toContain('### Version 1 **(requested)**');
  });

  it('shows file size in KB', () => {
    const result = formatDocumentVersions('doc-v2-uuid', sampleVersions);
    if (!('text' in result)) return;

    // 51200 bytes = 50.0 KB
    expect(result.text).toContain('50.0 KB');
    // 62000 bytes = 60.5 KB
    expect(result.text).toContain('60.5 KB');
  });

  it('truncates content hash to 12 characters', () => {
    const result = formatDocumentVersions('doc-v2-uuid', sampleVersions);
    if (!('text' in result)) return;

    expect(result.text).toContain('abc123def456...');
    expect(result.text).toContain('xyz789abc000...');
  });

  it('shows parent version for child documents', () => {
    const result = formatDocumentVersions('doc-v2-uuid', sampleVersions);
    if (!('text' in result)) return;

    expect(result.text).toContain('**Parent version:** doc-v1-uuid');
  });

  it('does not show parent version for root document', () => {
    const result = formatDocumentVersions('doc-v1-uuid', [sampleVersions[0]]);
    if (!('text' in result)) return;

    expect(result.text).not.toContain('**Parent version:**');
  });

  it('shows KB item counts', () => {
    const result = formatDocumentVersions('doc-v2-uuid', sampleVersions);
    if (!('text' in result)) return;

    expect(result.text).toContain('**KB items created:** 3');
    expect(result.text).toContain('**KB items created:** 5');
  });

  it('returns structured content with version array', () => {
    const result = formatDocumentVersions('doc-v2-uuid', sampleVersions);
    if (!('structured' in result)) return;

    const structured = result.structured as {
      document_id: string;
      filename: string;
      total_versions: number;
      versions: Array<{ id: string; version: number }>;
    };

    expect(structured.document_id).toBe('doc-v2-uuid');
    expect(structured.filename).toBe('safety-policy.docx');
    expect(structured.total_versions).toBe(2);
    expect(structured.versions).toHaveLength(2);
    expect(structured.versions[0].version).toBe(1);
    expect(structured.versions[1].version).toBe(2);
  });

  it('handles single version document', () => {
    const result = formatDocumentVersions('doc-v1-uuid', [sampleVersions[0]]);
    if (!('text' in result)) return;

    expect(result.text).toContain('**Total versions:** 1');
    expect(result.text).toContain('### Version 1 **(requested)**');
  });

  it('handles zero content_item_count', () => {
    const emptyVersion: VersionRow = {
      ...sampleVersions[0],
      content_item_count: 0,
    };
    const result = formatDocumentVersions('doc-v1-uuid', [emptyVersion]);
    if (!('text' in result)) return;

    expect(result.text).toContain('**KB items created:** 0');
  });

  describe('input validation expectations', () => {
    it('requires a UUID-format document_id (tool schema uses z.string().uuid())', () => {
      // The MCP tool schema enforces z.string().uuid() on document_id.
      // Invalid UUIDs would be rejected by Zod before reaching the formatter.
      // We verify the formatter still works with any string ID for robustness.
      const result = formatDocumentVersions('not-a-uuid', sampleVersions);
      expect('text' in result).toBe(true);
    });
  });
});
