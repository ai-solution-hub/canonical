'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Track the currently-active heading/section in the viewport via
 * IntersectionObserver. Shared by the guide and item-detail tables of contents.
 *
 * Observes the DOM elements whose ids are passed in and returns the id of the
 * topmost visible one. The observer is only attached when at least `minCount`
 * ids are supplied (mirrors the "don't show a ToC for one or two headings"
 * threshold the callers also enforce on render).
 *
 * @param ids - Ordered list of element ids to observe (section or heading ids).
 * @param minCount - Minimum number of ids before the observer is attached.
 * @returns The id of the active (topmost visible) element, or `null`.
 */
export function useActiveHeading(
  ids: string[],
  minCount: number,
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Re-run only when the set of ids (by value) or the threshold changes — the
  // joined key keeps a fresh array reference each render from churning the effect.
  const idsKey = ids.join(' ');

  useEffect(() => {
    if (ids.length < minCount) return;

    // Clean up previous observer
    observerRef.current?.disconnect();

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (intersections) => {
        // Find the first visible heading (topmost in viewport)
        const visible = intersections
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      },
    );

    elements.forEach((el) => observer.observe(el));
    observerRef.current = observer;

    return () => observer.disconnect();
    // `idsKey` is the value-stable proxy for `ids`; `ids` itself is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, minCount]);

  return activeId;
}
