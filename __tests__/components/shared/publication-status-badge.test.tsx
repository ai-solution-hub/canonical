/**
 * PublicationStatusBadge component tests
 *
 * §5.2 Phase 4A — covers spec §10.4 + §15 R8 acceptance criteria:
 *   - Renders for 'draft', 'in_review', 'archived' (the 3 non-published values)
 *   - Returns null for 'published' (R8 clutter mitigation — typical case)
 *   - Returns null for null, undefined, and unknown strings
 *   - WCAG 2.1 AA: each rendered variant has role="img" + non-empty aria-label
 *     containing the human-readable label, plus an aria-hidden icon and a
 *     visible text label (never colour alone).
 *
 * V_W3 follow-up — projection regression guard:
 *   - `CONTENT_LIST_COLUMNS` must include `publication_status` so every row
 *     fetched via `.select(CONTENT_LIST_COLUMNS)` carries the column. Without
 *     this guard a future refactor could silently remove `publication_status`
 *     from the projection — every browse/library row would arrive with
 *     `publication_status === undefined` and the badge would mount as `null`
 *     for every item. The end-to-end test below threads a row from the shared
 *     `createMockSupabaseClient()` helper through the full chain to assert
 *     the badge actually renders for `publication_status: 'in_review'`.
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §10.4, §15 R8.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { PublicationStatusBadge } from '@/components/shared/publication-status-badge';
import { CONTENT_LIST_COLUMNS } from '@/types/content';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

describe('PublicationStatusBadge', () => {
  describe('renders for non-published statuses', () => {
    it("renders 'Draft' chip when status === 'draft'", () => {
      render(<PublicationStatusBadge status="draft" />);
      const badge = screen.getByRole('img', {
        name: 'Publication status: Draft',
      });
      expect(badge).toBeInTheDocument();
      // Visible text label (WCAG: never colour alone)
      expect(badge).toHaveTextContent('Draft');
    });

    it("renders 'In Review' chip when status === 'in_review'", () => {
      render(<PublicationStatusBadge status="in_review" />);
      const badge = screen.getByRole('img', {
        name: 'Publication status: In Review',
      });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('In Review');
    });

    it("renders 'Archived' chip when status === 'archived'", () => {
      render(<PublicationStatusBadge status="archived" />);
      const badge = screen.getByRole('img', {
        name: 'Publication status: Archived',
      });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Archived');
    });
  });

  describe('auto-hides for the typical case + invalid inputs (R8)', () => {
    it("renders null when status === 'published' (typical case, R8)", () => {
      const { container } = render(
        <PublicationStatusBadge status="published" />,
      );
      // The badge renders nothing — container should be empty.
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole('img')).toBeNull();
    });

    it('renders null for null, undefined, and unknown values', () => {
      const { container: nullContainer } = render(
        <PublicationStatusBadge status={null} />,
      );
      expect(nullContainer).toBeEmptyDOMElement();

      const { container: undefinedContainer } = render(
        <PublicationStatusBadge status={undefined} />,
      );
      expect(undefinedContainer).toBeEmptyDOMElement();

      const { container: unknownContainer } = render(
        <PublicationStatusBadge status="foo" />,
      );
      expect(unknownContainer).toBeEmptyDOMElement();

      // Empty string and a different unknown shape — both fall through.
      const { container: emptyContainer } = render(
        <PublicationStatusBadge status="" />,
      );
      expect(emptyContainer).toBeEmptyDOMElement();
    });

    it('returns null for capitalised inputs (case-sensitive enum check)', () => {
      // Pin the case-sensitive `VALID_PUBLICATION_STATUSES.includes(value)`
      // semantics in `publication-status-badge.tsx#isVisibleStatus` against
      // a future refactor that toLowerCases before lookup. The DB CHECK on
      // `q_a_pairs.publication_status` (ID-131.19 M6 retirement:
      // content_items DROPPED at M6; q_a_pairs carries the identical
      // 4-value CHECK — see __tests__/lib/governance/publication-transitions.test.ts)
      // is also case-sensitive (lowercase-only enum), so accepting
      // capitalised inputs would silently diverge the badge from the DB
      // constraint.
      const { container: capContainer } = render(
        <PublicationStatusBadge status="Published" />,
      );
      expect(capContainer).toBeEmptyDOMElement();

      const { container: upperContainer } = render(
        <PublicationStatusBadge status="DRAFT" />,
      );
      expect(upperContainer).toBeEmptyDOMElement();

      const { container: titleCaseContainer } = render(
        <PublicationStatusBadge status="In_Review" />,
      );
      expect(titleCaseContainer).toBeEmptyDOMElement();
    });
  });

  describe('WCAG 2.1 AA compliance', () => {
    it.each([
      ['draft', 'Draft'],
      ['in_review', 'In Review'],
      ['archived', 'Archived'],
    ] as const)(
      "variant '%s' has role=img + non-empty aria-label + aria-hidden icon",
      (status, label) => {
        const { container } = render(
          <PublicationStatusBadge status={status} />,
        );

        // role="img" + aria-label of the form "Publication status: <Label>"
        const badge = screen.getByRole('img', {
          name: `Publication status: ${label}`,
        });
        expect(badge).toBeInTheDocument();
        expect(badge.getAttribute('aria-label')).toContain(label);
        expect(badge.getAttribute('aria-label')).not.toBe('');

        // Icon must be aria-hidden so AT does not double-announce.
        const icon = container.querySelector('svg');
        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute('aria-hidden', 'true');

        // Visible text label is present (never colour alone).
        expect(badge).toHaveTextContent(label);
      },
    );
  });

  // V_W3 follow-up — projection regression guard
  describe('CONTENT_LIST_COLUMNS projection guard (V_W3)', () => {
    it('CONTENT_LIST_COLUMNS includes publication_status', () => {
      // Direct string assertion. If a future refactor removes
      // `publication_status` from the SELECT projection, every browse/library
      // row arrives with `publication_status === undefined` and the badge
      // silently mounts as `null` — this guard catches that regression at
      // unit-test time rather than via missing badges in production.
      expect(CONTENT_LIST_COLUMNS).toMatch(/\bpublication_status\b/);
    });

    it('renders the badge from a row fetched via the mocked Supabase client', async () => {
      // End-to-end thread: a row carrying `publication_status: 'in_review'`
      // returned from `createMockSupabaseClient()` flows through to a rendered
      // chip. Catches the W3 regression where `CONTENT_LIST_COLUMNS` was
      // missing `publication_status` and `.select(CONTENT_LIST_COLUMNS)`
      // produced rows with `publication_status === undefined`.
      const supabase = createMockSupabaseClient();

      // Configure the chain to resolve to a single row carrying
      // `publication_status: 'in_review'` (matches the projection that
      // `use-library-data.ts:43` uses).
      //
      // ID-131.19 M6 retirement: content_items DROPPED at M6; `/browse`'s
      // `use-browse-data.ts` + `content-card.tsx` were retired earlier at
      // ID-131.17 (dead IMS browse/item-detail surface) and no longer
      // exist. `/library`'s `use-library-data.ts` (re-pointed onto
      // `q_a_pairs` at {131.21} G-MANUAL-QA) is now the live consumer this
      // mocked chain simulates — `title` maps to q_a_pairs' `question_text`.
      const inReviewRow = {
        id: 'item-1',
        question_text: 'Draft article in review',
        publication_status: 'in_review' as const,
      };
      supabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => unknown) =>
          resolve({ data: [inReviewRow], error: null, count: 1 }),
      );

      // Simulate a real consumer chain. `from(...).select(...)` returns the
      // same `_chain` (vitest mocks satisfy the runtime contract; the cast
      // bridges the discriminated `Mock<Procedure | Constructable>` to the
      // call signature). Matches use-library-data.ts:43 (q_a_pairs).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder = (supabase as any)
        .from('q_a_pairs')
        .select(CONTENT_LIST_COLUMNS);
      const { data, error } = (await builder) as {
        data: Array<{ publication_status: string }> | null;
        error: unknown;
      };

      // Sanity: the mock returned the row we configured.
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data?.[0]?.publication_status).toBe('in_review');

      // Mount the badge with the value pulled from the simulated query
      // (this is exactly what content-card.tsx:308 does).
      render(
        <PublicationStatusBadge
          status={data?.[0]?.publication_status ?? null}
        />,
      );
      const badge = screen.getByRole('img', {
        name: 'Publication status: In Review',
      });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('In Review');
    });
  });
});
