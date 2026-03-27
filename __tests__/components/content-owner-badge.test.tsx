import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentOwnerBadge } from '@/components/content/content-owner-badge';

describe('ContentOwnerBadge', () => {
  describe('sm size (default)', () => {
    it('renders nothing when ownerName is null', () => {
      const { container } = render(<ContentOwnerBadge ownerName={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders the owner name with a person icon', () => {
      render(<ContentOwnerBadge ownerName="Alice Smith" />);
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    it('applies sm text size by default', () => {
      render(<ContentOwnerBadge ownerName="Bob" />);
      const el = screen.getByText('Bob').parentElement;
      expect(el?.className).toContain('text-xs');
    });
  });

  describe('md size', () => {
    it('shows "Unassigned" when ownerName is null', () => {
      render(<ContentOwnerBadge ownerName={null} size="md" />);
      expect(screen.getByText('Unassigned')).toBeInTheDocument();
    });

    it('shows the owner name when provided', () => {
      render(<ContentOwnerBadge ownerName="Charlie" size="md" />);
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });

    it('applies md text size', () => {
      render(<ContentOwnerBadge ownerName="Charlie" size="md" />);
      const el = screen.getByText('Charlie').parentElement;
      expect(el?.className).toContain('text-sm');
    });
  });

  it('applies custom className', () => {
    render(
      <ContentOwnerBadge ownerName="Test" className="my-custom-class" />,
    );
    const el = screen.getByText('Test').parentElement;
    expect(el?.className).toContain('my-custom-class');
  });
});
