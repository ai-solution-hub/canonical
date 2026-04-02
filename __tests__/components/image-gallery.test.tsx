/**
 * ImageGallery Component Tests
 *
 * Tests extract button, loading state, image grid rendering, page badges,
 * lightbox dialog, navigation arrows, image info bar, and empty state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/error', () => ({
  safeErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} src={props.src as string} alt={props.alt as string} />
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ImageGallery } from '@/components/reader/image-gallery';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGalleryImages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/img-${i}.png`,
    page: i + 1,
    index: i,
    width: 800,
    height: 600,
    format: 'png',
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageGallery', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows extract button when no images have been extracted', () => {
    render(<ImageGallery itemId="item-1" hasExtractedImages={false} />);

    expect(
      screen.getByRole('button', { name: /extract images/i }),
    ).toBeInTheDocument();
  });

  it('shows loading state while fetching images', async () => {
    // Mock a fetch that never resolves during this test
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<ImageGallery itemId="item-1" hasExtractedImages={true} />);

    expect(screen.getByText('Loading images...')).toBeInTheDocument();
  });

  it('renders image grid with correct count after fetch', async () => {
    const images = createGalleryImages(3);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ images, extracted_at: '2026-01-01' }),
    });

    render(<ImageGallery itemId="item-1" hasExtractedImages={true} />);

    await waitFor(() => {
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('list', { name: /extracted pdf images/i }),
    ).toBeInTheDocument();
  });

  it('shows page badge on each thumbnail', async () => {
    const images = createGalleryImages(2);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ images, extracted_at: '2026-01-01' }),
    });

    render(<ImageGallery itemId="item-1" hasExtractedImages={true} />);

    await waitFor(() => {
      expect(screen.getByText('Page 1')).toBeInTheDocument();
      expect(screen.getByText('Page 2')).toBeInTheDocument();
    });
  });

  it('opens lightbox dialog on thumbnail click', async () => {
    const user = userEvent.setup();
    const images = createGalleryImages(2);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ images, extracted_at: '2026-01-01' }),
    });

    render(<ImageGallery itemId="item-1" hasExtractedImages={true} />);

    await waitFor(() => {
      expect(screen.getByText('Page 1')).toBeInTheDocument();
    });

    // Click first thumbnail
    const thumbnails = screen.getAllByRole('listitem');
    await user.click(thumbnails[0]);

    // Lightbox should open with close button
    await waitFor(() => {
      expect(screen.getByLabelText('Close preview')).toBeInTheDocument();
    });
  });

  it('shows navigation arrows for multiple images in lightbox', async () => {
    const user = userEvent.setup();
    const images = createGalleryImages(3);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ images, extracted_at: '2026-01-01' }),
    });

    render(<ImageGallery itemId="item-1" hasExtractedImages={true} />);

    await waitFor(() => {
      expect(screen.getByText('Page 1')).toBeInTheDocument();
    });

    const thumbnails = screen.getAllByRole('listitem');
    await user.click(thumbnails[0]);

    await waitFor(() => {
      expect(screen.getByLabelText('Previous image')).toBeInTheDocument();
      expect(screen.getByLabelText('Next image')).toBeInTheDocument();
    });
  });

  it('shows image info bar in lightbox', async () => {
    const user = userEvent.setup();
    const images = createGalleryImages(2);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ images, extracted_at: '2026-01-01' }),
    });

    render(<ImageGallery itemId="item-1" hasExtractedImages={true} />);

    await waitFor(() => {
      expect(screen.getByText('Page 1')).toBeInTheDocument();
    });

    const thumbnails = screen.getAllByRole('listitem');
    await user.click(thumbnails[0]);

    await waitFor(() => {
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });
  });

  it('shows "No extractable images" when extraction yields none', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ images: [], total_uploaded: 0 }),
    });

    render(<ImageGallery itemId="item-1" hasExtractedImages={false} />);

    await user.click(screen.getByRole('button', { name: /extract images/i }));

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'No extractable images found in this PDF.',
      );
    });
  });
});
