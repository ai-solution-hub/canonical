import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useContentTemplates } from '@/hooks/use-content-templates';
import { CONTENT_TEMPLATES } from '@/lib/content-templates';

describe('useContentTemplates', () => {
  it('returns templates array', () => {
    const { result } = renderHook(() => useContentTemplates());

    expect(Array.isArray(result.current.templates)).toBe(true);
    expect(result.current.templates.length).toBeGreaterThan(0);
  });

  it('returns isLoading as false (Phase 1 — code constants)', () => {
    const { result } = renderHook(() => useContentTemplates());

    expect(result.current.isLoading).toBe(false);
  });

  it('returns the same templates as CONTENT_TEMPLATES constant', () => {
    const { result } = renderHook(() => useContentTemplates());

    expect(result.current.templates).toEqual(CONTENT_TEMPLATES);
  });

  it('returns a stable reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useContentTemplates());

    const firstTemplates = result.current.templates;
    rerender();
    const secondTemplates = result.current.templates;

    // Same reference because code constants are static
    expect(firstTemplates).toBe(secondTemplates);
  });

  it('each template has required fields', () => {
    const { result } = renderHook(() => useContentTemplates());

    for (const template of result.current.templates) {
      expect(template.id).toBeTruthy();
      expect(template.slug).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.contentType).toBeTruthy();
    }
  });
});
