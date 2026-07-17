/**
 * Upload shell state contract (ID-147.18, PRODUCT.md §E1/§E3/§E4).
 *
 * `UploadShell` is the STATE layer wrapping the ID-147.6 vendored
 * `FileUpload` affordance: client-side type/size/count/duplicate
 * validation inline before submission (§E1), progress + success states,
 * and an honest rejection message sourced from the backend's actual
 * response (§E4) — wired, unchanged, to the existing hardened BI-9
 * `POST /api/procurement/upload` item-creation path (§E3, ID-145 BI-9).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UploadShell } from '@/components/procurement/extend/upload-shell';
import { createMockFile } from '@/__tests__/helpers/factories/file-upload';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

function jsonResponse(data: unknown, ok = true, status = ok ? 201 : 400) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('UploadShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the upload affordance in idle state', () => {
    render(<UploadShell />);
    expect(getFileInput()).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---- §E1 client-side validation, inline, before submission ----

  it('rejects an oversized file inline before submission, without calling the backend', async () => {
    const user = userEvent.setup();
    render(<UploadShell />);

    const oversizedFile = createMockFile({
      name: 'huge.pdf',
      size: 60 * 1024 * 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), oversizedFile);

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a batch exceeding the maximum file count inline, without calling the backend', async () => {
    const user = userEvent.setup();
    render(<UploadShell maxFiles={1} />);

    const fileA = createMockFile({
      name: 'a.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    const fileB = createMockFile({
      name: 'b.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), [fileA, fileB]);

    expect(
      await screen.findByText(/up to 1 file at a time/i),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects duplicate files within the same selection inline, without calling the backend', async () => {
    const user = userEvent.setup();
    render(<UploadShell maxFiles={2} />);

    const fileA = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    const duplicate = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), [fileA, duplicate]);

    expect(
      await screen.findByText(/already (been )?(added|selected)/i),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows the inline validation message alongside an icon (not colour-only)', async () => {
    const user = userEvent.setup();
    const { container } = render(<UploadShell />);

    const oversizedFile = createMockFile({
      name: 'huge.pdf',
      size: 60 * 1024 * 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), oversizedFile);

    await screen.findByText(/too large/i);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  // ---- §E3/§E4 happy path — bound to the hardened BI-9 backend ----

  it('uploads a valid file to the hardened BI-9 endpoint and shows a success state', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        id: 'form-1',
        name: 'Tender response form',
        filename: 'tender.pdf',
      }),
    );

    const user = userEvent.setup();
    const onUploaded = vi.fn();
    render(<UploadShell onUploaded={onUploaded} />);

    const file = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), file);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/procurement/upload',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const [, requestInit] = mockFetch.mock.calls[0];
    expect(requestInit.body).toBeInstanceOf(FormData);
    expect((requestInit.body as FormData).get('file')).toBe(file);

    expect(await screen.findByText(/upload complete/i)).toBeInTheDocument();
    expect(screen.getByText('Tender response form')).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'form-1', name: 'Tender response form' }),
    );
  });

  it('shows an indeterminate progress state while the upload is in flight', async () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    const user = userEvent.setup();
    render(<UploadShell />);

    const file = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), file);

    expect(await screen.findByText(/uploading/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('resets to idle when "Upload another" is clicked after success', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ id: 'form-1', name: 'Tender response form' }),
    );

    const user = userEvent.setup();
    render(<UploadShell />);

    const file = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), file);
    await screen.findByText(/upload complete/i);

    await user.click(screen.getByRole('button', { name: /upload another/i }));
    expect(getFileInput()).toBeInTheDocument();
    expect(screen.queryByText(/upload complete/i)).not.toBeInTheDocument();
  });

  // ---- §E4 honest rejection ----

  it('shows the backend’s actual rejection reason, not a generic failure', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse(
        {
          error:
            'File content does not match its declared type. Ensure the file is a genuine document of the declared type.',
        },
        false,
        415,
      ),
    );

    const user = userEvent.setup();
    render(<UploadShell />);

    const file = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), file);

    expect(
      await screen.findByText(
        'File content does not match its declared type. Ensure the file is a genuine document of the declared type.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the backend’s rate-limit reason on a 429', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse(
        { error: 'Rate limit exceeded. Please try again shortly.' },
        false,
        429,
      ),
    );

    const user = userEvent.setup();
    render(<UploadShell />);

    const file = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), file);

    expect(
      await screen.findByText('Rate limit exceeded. Please try again shortly.'),
    ).toBeInTheDocument();
  });

  it('shows a fallback message (not a raw exception) when the network request throws', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const user = userEvent.setup();
    render(<UploadShell />);

    const file = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), file);

    expect(
      await screen.findByText(/couldn't upload|something went wrong/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('allows retrying after a rejection', async () => {
    mockFetch
      .mockReturnValueOnce(jsonResponse({ error: 'Storage error' }, false, 500))
      .mockReturnValueOnce(jsonResponse({ id: 'form-1', name: 'Retry form' }));

    const user = userEvent.setup();
    render(<UploadShell />);

    const file = createMockFile({
      name: 'tender.pdf',
      size: 1024,
      type: 'application/pdf',
      construction: 'plain',
    });
    await user.upload(getFileInput(), file);
    await screen.findByText('Storage error');

    // The affordance stays available for a fresh attempt.
    await user.upload(getFileInput(), file);
    expect(await screen.findByText(/upload complete/i)).toBeInTheDocument();
  });
});
