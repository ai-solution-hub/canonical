/**
 * DetailModeToggle Component Tests
 *
 * Tests the segmented toggle for switching between Reader and Editor modes:
 * - Renders both Read and Edit segments
 * - Active/inactive states based on detailMode
 * - Calls onToggle when inactive segment is clicked
 * - Does not call onToggle when active segment is clicked
 * - Accessibility: aria-pressed, aria-label, tooltip
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DetailModeToggle } from '@/components/item-detail/detail-mode-toggle';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DetailModeToggle', () => {
  const defaultProps = {
    detailMode: 'editor' as const,
    onToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders Read and Edit segments', () => {
      render(<DetailModeToggle {...defaultProps} />);

      expect(screen.getByText('Read')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('renders group with aria-label', () => {
      render(<DetailModeToggle {...defaultProps} />);

      expect(screen.getByRole('group', { name: 'Detail view mode' })).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<DetailModeToggle {...defaultProps} className="test-class" />);

      const group = screen.getByRole('group', { name: 'Detail view mode' });
      expect(group).toHaveClass('test-class');
    });
  });

  describe('editor mode active', () => {
    it('marks Edit as pressed and Read as not pressed', () => {
      render(<DetailModeToggle detailMode="editor" onToggle={vi.fn()} />);

      const readButton = screen.getByText('Read').closest('button')!;
      const editButton = screen.getByText('Edit').closest('button')!;

      expect(readButton).toHaveAttribute('aria-pressed', 'false');
      expect(editButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('calls onToggle when Read is clicked', async () => {
      const onToggle = vi.fn();
      render(<DetailModeToggle detailMode="editor" onToggle={onToggle} />);

      const readButton = screen.getByText('Read').closest('button')!;
      await userEvent.click(readButton);

      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('does not call onToggle when Edit is clicked (already active)', async () => {
      const onToggle = vi.fn();
      render(<DetailModeToggle detailMode="editor" onToggle={onToggle} />);

      const editButton = screen.getByText('Edit').closest('button')!;
      await userEvent.click(editButton);

      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('reader mode active', () => {
    it('marks Read as pressed and Edit as not pressed', () => {
      render(<DetailModeToggle detailMode="reader" onToggle={vi.fn()} />);

      const readButton = screen.getByText('Read').closest('button')!;
      const editButton = screen.getByText('Edit').closest('button')!;

      expect(readButton).toHaveAttribute('aria-pressed', 'true');
      expect(editButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('calls onToggle when Edit is clicked', async () => {
      const onToggle = vi.fn();
      render(<DetailModeToggle detailMode="reader" onToggle={onToggle} />);

      const editButton = screen.getByText('Edit').closest('button')!;
      await userEvent.click(editButton);

      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('does not call onToggle when Read is clicked (already active)', async () => {
      const onToggle = vi.fn();
      render(<DetailModeToggle detailMode="reader" onToggle={onToggle} />);

      const readButton = screen.getByText('Read').closest('button')!;
      await userEvent.click(readButton);

      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
