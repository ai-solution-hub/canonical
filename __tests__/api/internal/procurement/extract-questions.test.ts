/**
 * Tests for POST /api/internal/procurement/extract-questions.
 *
 * ID-145 {145.13} — the Plane-1 (questions) extraction bridge the
 * analyse_form worker (`scripts/bid_worker.py`, Python, no browser session)
 * calls instead of {145.12}'s session-gated `[id]/questions/extract/route.ts`.
 * See the route's own header comment for the full rationale.
 *
 * Acceptance:
 *   - POST with valid `Authorization: Bearer <PIPELINE_TRIGGER_SECRET>` (or
 *     the legacy shared `CRON_SECRET`, dual-accept) + a valid body runs the
 *     matching {145.12} extractor and returns its raw result — NO DB access.
 *   - A bearer matching neither secret returns 401 (unauthorised) BEFORE any
 *     extraction runs.
 *   - format='pdf' calls `extractPDFQuestions` with the base64 string
 *     as-is; format='docx'/'xlsx' decode to a Buffer first.
 *   - A malformed body (bad format enum, missing content) 400s via Zod.
 *   - An extractor failure surfaces as 500, not an unhandled throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCronRequest } from '../../../helpers/factories/cron-request';

const { mockVerifyPipelineTriggerAuth } = vi.hoisted(() => ({
  mockVerifyPipelineTriggerAuth: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({
  verifyPipelineTriggerAuth: mockVerifyPipelineTriggerAuth,
}));

const {
  mockExtractPDFQuestions,
  mockExtractDOCXQuestions,
  mockExtractXLSXQuestions,
} = vi.hoisted(() => ({
  mockExtractPDFQuestions: vi.fn(),
  mockExtractDOCXQuestions: vi.fn(),
  mockExtractXLSXQuestions: vi.fn(),
}));

vi.mock('@/lib/domains/procurement/ai/extract-questions', () => ({
  extractPDFQuestions: mockExtractPDFQuestions,
  extractDOCXQuestions: mockExtractDOCXQuestions,
  extractXLSXQuestions: mockExtractXLSXQuestions,
}));

vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

import { POST } from '@/app/api/internal/procurement/extract-questions/route';

const ROUTE_PATH = '/api/internal/procurement/extract-questions';

const FAKE_RESULT = {
  sections: [
    {
      section_name: 'Section A',
      section_sequence: 0,
      questions: [
        {
          question_text: 'Company name?',
          question_sequence: 0,
          word_limit: null,
          evaluation_weight: null,
          category: 'mandatory',
          expected_response_kind: 'mandatory',
        },
      ],
    },
  ],
};

function buildRequest(overrides: {
  omitAuth?: boolean;
  secret?: string;
  body?: Record<string, unknown> | string;
}): Request {
  return createMockCronRequest({
    path: ROUTE_PATH,
    method: 'POST',
    ...(overrides.omitAuth ? {} : { secret: overrides.secret }),
    body: overrides.body,
  });
}

describe('POST /api/internal/procurement/extract-questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyPipelineTriggerAuth.mockReturnValue(true);
  });

  it('returns 401 when verifyPipelineTriggerAuth rejects the request', async () => {
    mockVerifyPipelineTriggerAuth.mockReturnValue(false);

    const res = await POST(
      buildRequest({
        body: { format: 'pdf', content_base64: 'JVBERi0=' },
      }) as never,
    );

    expect(res.status).toBe(401);
    expect(mockExtractPDFQuestions).not.toHaveBeenCalled();
  });

  it('calls extractPDFQuestions with the base64 string as-is for format=pdf', async () => {
    mockExtractPDFQuestions.mockResolvedValue(FAKE_RESULT);

    const res = await POST(
      buildRequest({
        body: { format: 'pdf', content_base64: 'JVBERi0=' },
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(FAKE_RESULT);
    expect(mockExtractPDFQuestions).toHaveBeenCalledWith('JVBERi0=');
    expect(mockExtractDOCXQuestions).not.toHaveBeenCalled();
    expect(mockExtractXLSXQuestions).not.toHaveBeenCalled();
  });

  it('decodes content_base64 to a Buffer for format=docx', async () => {
    mockExtractDOCXQuestions.mockResolvedValue(FAKE_RESULT);
    const b64 = Buffer.from('fake docx bytes').toString('base64');

    const res = await POST(
      buildRequest({ body: { format: 'docx', content_base64: b64 } }) as never,
    );

    expect(res.status).toBe(200);
    expect(mockExtractDOCXQuestions).toHaveBeenCalledTimes(1);
    const [buf] = mockExtractDOCXQuestions.mock.calls[0];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('fake docx bytes');
  });

  it('decodes content_base64 to a Buffer for format=xlsx', async () => {
    mockExtractXLSXQuestions.mockResolvedValue(FAKE_RESULT);
    const b64 = Buffer.from('fake xlsx bytes').toString('base64');

    const res = await POST(
      buildRequest({ body: { format: 'xlsx', content_base64: b64 } }) as never,
    );

    expect(res.status).toBe(200);
    expect(mockExtractXLSXQuestions).toHaveBeenCalledTimes(1);
    const [buf] = mockExtractXLSXQuestions.mock.calls[0];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('fake xlsx bytes');
  });

  it('400s on an invalid format enum value', async () => {
    const res = await POST(
      buildRequest({
        body: { format: 'html', content_base64: 'abc' },
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(mockExtractPDFQuestions).not.toHaveBeenCalled();
  });

  it('400s when content_base64 is missing', async () => {
    const res = await POST(buildRequest({ body: { format: 'pdf' } }) as never);

    expect(res.status).toBe(400);
  });

  it('returns 500 when the extractor throws, without leaking an unhandled error', async () => {
    mockExtractPDFQuestions.mockRejectedValue(new Error('Anthropic 529'));

    const res = await POST(
      buildRequest({
        body: { format: 'pdf', content_base64: 'JVBERi0=' },
      }) as never,
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    // safeErrorMessage() only echoes the raw error text in development
    // (lib/error.ts) — in test/prod NODE_ENV it returns the fallback only.
    expect(body.error).toBe('Failed to extract questions');
  });
});
