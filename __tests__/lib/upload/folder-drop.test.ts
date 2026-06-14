// __tests__/lib/upload/folder-drop.test.ts
/**
 * Unit tests for the folder-drop staging client ({56.12}, ID-56 Path B).
 *
 * Covers the load-bearing contracts:
 *  - destPath is corpus-relative + consumed verbatim (INV-1); absolute / `..`
 *    escape rejected.
 *  - /stage is called BEFORE /walk (order is load-bearing — incremental walk
 *    must see the landed bytes).
 *  - the source_file correlation key is the basename of the echoed destPath.
 *  - no silent failure: every leg that fails throws a typed FolderDropError
 *    carrying the failing stage.
 *  - 409 from /walk (walk already in flight) is treated as success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  stageAndWalk,
  assertCorpusRelativeDestPath,
  FolderDropError,
} from '@/lib/upload/folder-drop';

const WORKER_URL = 'http://cocoindex.test';
const CRON_SECRET = 'test-secret';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('assertCorpusRelativeDestPath', () => {
  it('returns a valid relative path verbatim (INV-1, no re-normalisation)', () => {
    expect(assertCorpusRelativeDestPath('uploads/My File.pdf')).toBe(
      'uploads/My File.pdf',
    );
    // Verbatim: a path with a redundant `./` is NOT rewritten.
    expect(assertCorpusRelativeDestPath('a/./b.md')).toBe('a/./b.md');
  });

  it('rejects an absolute destPath with a destPath-stage error', () => {
    expect(() => assertCorpusRelativeDestPath('/etc/passwd')).toThrow(
      FolderDropError,
    );
    try {
      assertCorpusRelativeDestPath('/abs.pdf');
    } catch (e) {
      expect((e as FolderDropError).stage).toBe('destPath');
    }
  });

  it('rejects a `..`-escaping destPath', () => {
    expect(() => assertCorpusRelativeDestPath('../../secret.pdf')).toThrow(
      /escape the corpus root/,
    );
  });

  it('rejects an empty destPath', () => {
    expect(() => assertCorpusRelativeDestPath('')).toThrow(FolderDropError);
  });
});

describe('stageAndWalk', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('COCOINDEX_WORKER_URL', WORKER_URL);
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const input = {
    bytes: new Uint8Array([1, 2, 3]),
    filename: 'report.pdf',
    destPath: 'uploads/report.pdf',
    titlePrefix: 'Q3',
  };

  it('calls /stage then /walk in order and returns the source_file key', async () => {
    const calls: string[] = [];
    fetchMock.mockImplementation((url: string) => {
      calls.push(url);
      if (url.endsWith('/stage')) {
        return Promise.resolve(
          jsonResponse({ destPath: 'uploads/report.pdf', requestId: 'rq1' }),
        );
      }
      return Promise.resolve(jsonResponse({ requestId: 'rw1' }, 202));
    });

    const result = await stageAndWalk(input);

    // Order: stage MUST precede walk.
    expect(calls).toEqual([`${WORKER_URL}/stage`, `${WORKER_URL}/walk`]);
    // source_file correlation key is the basename of the echoed destPath.
    expect(result.sourceFile).toBe('report.pdf');
    expect(result.destPath).toBe('uploads/report.pdf');
    expect(result.stageRequestId).toBe('rq1');
  });

  it('sends /stage as multipart with file + destPath + titlePrefix', async () => {
    let stageBody: FormData | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stage')) {
        stageBody = init?.body as FormData;
        return Promise.resolve(
          jsonResponse({ destPath: 'uploads/report.pdf', requestId: 'rq1' }),
        );
      }
      return Promise.resolve(jsonResponse({}, 202));
    });

    await stageAndWalk(input);

    expect(stageBody).toBeInstanceOf(FormData);
    expect(stageBody?.get('destPath')).toBe('uploads/report.pdf');
    expect(stageBody?.get('titlePrefix')).toBe('Q3');
    expect(stageBody?.get('file')).toBeInstanceOf(Blob);
  });

  it('sends the bearer secret on /walk', async () => {
    let walkAuth: string | null = null;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stage')) {
        return Promise.resolve(
          jsonResponse({ destPath: 'uploads/report.pdf', requestId: 'rq1' }),
        );
      }
      walkAuth = new Headers(init?.headers).get('Authorization');
      return Promise.resolve(jsonResponse({}, 202));
    });

    await stageAndWalk(input);
    expect(walkAuth).toBe(`Bearer ${CRON_SECRET}`);
  });

  it('treats /walk 409 (walk already in flight) as success', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stage')) {
        return Promise.resolve(
          jsonResponse({ destPath: 'uploads/report.pdf', requestId: 'rq1' }),
        );
      }
      return Promise.resolve(jsonResponse({ error: 'in flight' }, 409));
    });

    const result = await stageAndWalk(input);
    expect(result.sourceFile).toBe('report.pdf');
  });

  it('throws a config-stage error when COCOINDEX_WORKER_URL is unset', async () => {
    vi.stubEnv('COCOINDEX_WORKER_URL', '');
    await expect(stageAndWalk(input)).rejects.toMatchObject({
      stage: 'config',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a config-stage error when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');
    await expect(stageAndWalk(input)).rejects.toMatchObject({
      stage: 'config',
    });
  });

  it('throws a stage-stage error (carrying status) when /stage rejects', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad destPath' }, 400));
    let err: FolderDropError | undefined;
    try {
      await stageAndWalk(input);
    } catch (e) {
      err = e as FolderDropError;
    }
    expect(err?.stage).toBe('stage');
    expect(err?.status).toBe(400);
    // /walk must NOT have been attempted after a failed /stage.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a walk-stage error when bytes staged but /walk is rejected', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stage')) {
        return Promise.resolve(
          jsonResponse({ destPath: 'uploads/report.pdf', requestId: 'rq1' }),
        );
      }
      return Promise.resolve(jsonResponse({ error: 'auth' }, 401));
    });
    let err: FolderDropError | undefined;
    try {
      await stageAndWalk(input);
    } catch (e) {
      err = e as FolderDropError;
    }
    expect(err?.stage).toBe('walk');
    expect(err?.status).toBe(401);
  });

  it('throws a stage-stage error when /stage returns no destPath', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ requestId: 'rq1' }));
    await expect(stageAndWalk(input)).rejects.toMatchObject({ stage: 'stage' });
  });

  it('rejects an absolute destPath before any network call', async () => {
    await expect(
      stageAndWalk({ ...input, destPath: '/abs.pdf' }),
    ).rejects.toMatchObject({ stage: 'destPath' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
