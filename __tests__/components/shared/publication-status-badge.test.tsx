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
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §10.4, §15 R8.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { PublicationStatusBadge } from '@/components/shared/publication-status-badge';

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
});
