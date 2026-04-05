// __tests__/lib/intelligence/google-news-dedup.test.ts
// Tests for SI-M1: Google News URL dedup resolution
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isGoogleNewsUrl,
  resolveGoogleNewsUrl,
} from '@/lib/intelligence/content-extractor';

// Mock Firecrawl (required by content-extractor module)
vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(function () {
    return { scrape: vi.fn() };
  }),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('SI-M1: Google News URL Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isGoogleNewsUrl', () => {
    it('detects news.google.com URLs', () => {
      expect(
        isGoogleNewsUrl(
          'https://news.google.com/rss/articles/CBMiX2h0dHBzOi8vd3d3',
        ),
      ).toBe(true);
    });

    it('returns false for non-Google-News URLs', () => {
      expect(isGoogleNewsUrl('https://www.gov.uk/some-article')).toBe(false);
      expect(isGoogleNewsUrl('https://google.com/search?q=news')).toBe(false);
    });

    it('returns false for invalid URLs', () => {
      expect(isGoogleNewsUrl('not-a-url')).toBe(false);
    });
  });

  describe('resolveGoogleNewsUrl', () => {
    it('returns original URL for non-Google-News URLs', async () => {
      const url = 'https://www.gov.uk/article';
      const result = await resolveGoogleNewsUrl(url);
      expect(result).toBe(url);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('follows redirect to resolve Google News URL via HEAD', async () => {
      const googleUrl = 'https://news.google.com/rss/articles/CBMiX2h0dHBz';
      const resolvedUrl = 'https://www.bbc.co.uk/news/education-12345';

      mockFetch.mockResolvedValueOnce({
        url: resolvedUrl,
      });

      const result = await resolveGoogleNewsUrl(googleUrl);
      expect(result).toBe(resolvedUrl);
      expect(mockFetch).toHaveBeenCalledWith(
        googleUrl,
        expect.objectContaining({ method: 'HEAD', redirect: 'follow' }),
      );
    });

    it('falls back to GET if HEAD returns same URL', async () => {
      const googleUrl = 'https://news.google.com/rss/articles/CBMiX2h0dHBz';
      const resolvedUrl = 'https://www.bbc.co.uk/news/education-12345';

      // HEAD returns same URL (some servers don't follow redirects for HEAD)
      mockFetch.mockResolvedValueOnce({ url: googleUrl });
      // GET follows redirect
      mockFetch.mockResolvedValueOnce({ url: resolvedUrl });

      const result = await resolveGoogleNewsUrl(googleUrl);
      expect(result).toBe(resolvedUrl);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns original URL on fetch error', async () => {
      const googleUrl = 'https://news.google.com/rss/articles/CBMiX2h0dHBz';

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await resolveGoogleNewsUrl(googleUrl);
      expect(result).toBe(googleUrl);
    });

    it('returns original URL when redirect target is same as input', async () => {
      const googleUrl = 'https://news.google.com/rss/articles/CBMiX2h0dHBz';

      // Both HEAD and GET return the same URL (no redirect)
      mockFetch.mockResolvedValueOnce({ url: googleUrl });
      mockFetch.mockResolvedValueOnce({ url: googleUrl });

      const result = await resolveGoogleNewsUrl(googleUrl);
      expect(result).toBe(googleUrl);
    });
  });
});
