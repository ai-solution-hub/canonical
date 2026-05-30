/**
 * Helper-level unit test for `stageFixture` (ID-62.8).
 *
 * Runs under the UNIT Vitest project (`bun run test`) — it is a plain
 * `*.test.ts` (NOT `*.integration.test.ts`), so it is collected by
 * vitest.config.ts and excluded from the live-creds integration project. It
 * touches no live Supabase: `stageFixture` only `fetch`es the staging URL,
 * and `fetch` is mocked here.
 *
 * The assertion is the {62.8} behaviour invariant: the request carries the
 * fixture BYTES as `multipart/form-data` (a `file` part), NOT a JSON path
 * the writer can't resolve, and NO `application/json` header is set (so
 * `fetch` is free to set the multipart boundary). The env-gate throw, the
 * non-2xx throw, and the `{ destPath, requestId }` response read are
 * preserved verbatim from the JSON-era contract.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stageFixture } from './fixture-staging';

const STAGING_URL = 'http://staging.example.test';
const FIXTURE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]); // "PK.." — fake xlsx magic

let tmpDir: string;
let fixturePath: string;
let fetchMock: ReturnType<typeof vi.fn>;

function okResponse(body: { destPath?: string; requestId?: string }): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'stage-fixture-test-'));
  fixturePath = join(tmpDir, 'source-fixture.xlsx');
  await writeFile(fixturePath, FIXTURE_BYTES);

  process.env.COCOINDEX_FIXTURE_STAGING_URL = STAGING_URL;

  fetchMock = vi
    .fn()
    .mockResolvedValue(
      okResponse({ destPath: 'forms/P-123-form.xlsx', requestId: 'req-abc' }),
    );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.COCOINDEX_FIXTURE_STAGING_URL;
  await rm(tmpDir, { recursive: true, force: true });
});

describe('stageFixture wire contract (ID-62.8)', () => {
  it('POSTs multipart FormData with the fixture bytes and no application/json header', async () => {
    await stageFixture({
      fixturePath,
      destPath: 'forms/P-123-form.xlsx',
      titlePrefix: 'P-123',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(endpoint).toBe(`${STAGING_URL}/stage`);
    expect(init.method).toBe('POST');

    // No explicit Content-Type — fetch sets the multipart boundary itself.
    // (The JSON-era `application/json` header must be gone.)
    expect(init.headers).toBeUndefined();

    // Body is FormData carrying a `file` part (the bytes) + the text parts.
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;

    const filePart = form.get('file');
    expect(filePart).toBeInstanceOf(Blob);
    expect(form.get('destPath')).toBe('forms/P-123-form.xlsx');
    expect(form.get('titlePrefix')).toBe('P-123');

    // The bytes on the wire are the fixture bytes — not a path string.
    const sentBytes = new Uint8Array(await (filePart as Blob).arrayBuffer());
    expect(Array.from(sentBytes)).toEqual(Array.from(FIXTURE_BYTES));

    // The file part is named after basename(destPath) (route writes there).
    expect((filePart as File).name).toBe('P-123-form.xlsx');
  });

  it('throws when COCOINDEX_FIXTURE_STAGING_URL is unset (env-gate preserved)', async () => {
    delete process.env.COCOINDEX_FIXTURE_STAGING_URL;
    await expect(
      stageFixture({
        fixturePath,
        destPath: 'forms/x.xlsx',
        titlePrefix: 'P-',
      }),
    ).rejects.toThrow(/COCOINDEX_FIXTURE_STAGING_URL is unset/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx response (failure surfaced, not swallowed)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'destPath escapes the corpus root',
      json: async () => ({}),
    } as unknown as Response);

    await expect(
      stageFixture({
        fixturePath,
        destPath: '../escape.xlsx',
        titlePrefix: 'P-',
      }),
    ).rejects.toThrow(/staging service returned 400 Bad Request/);
  });

  it('reads { destPath, requestId } from the response body', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ destPath: 'forms/echoed.xlsx', requestId: 'req-xyz' }),
    );

    const result = await stageFixture({
      fixturePath,
      destPath: 'forms/local.xlsx',
      titlePrefix: 'P-',
    });

    expect(result.destPath).toBe('forms/echoed.xlsx');
    expect(result.requestId).toBe('req-xyz');
  });
});
