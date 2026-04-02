/**
 * DedupWarning Component Tests
 *
 * Tests the inline duplicate warning alert component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DedupWarning,
  type DedupMatch,
} from '@/components/shared/dedup-warning';

const defaultMatches: DedupMatch[] = [
  {
    id: 'item-1',
    title: 'ISO 27001 Overview',
    similarity: 0.95,
    match_type: 'near_duplicate',
  },
  {
    id: 'item-2',
    title: 'Security Policy Document',
    similarity: 1.0,
    match_type: 'exact',
  },
];

describe('DedupWarning', () => {
  it('renders match titles and similarity percentages', () => {
    render(
      <DedupWarning
        matches={defaultMatches}
        onViewMatch={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('ISO 27001 Overview')).toBeInTheDocument();
    expect(screen.getByText('Security Policy Document')).toBeInTheDocument();
    expect(screen.getByText('95% similar')).toBeInTheDocument();
  });

  it('distinguishes exact vs near_duplicate match types', () => {
    render(
      <DedupWarning
        matches={defaultMatches}
        onViewMatch={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Exact match')).toBeInTheDocument();
    expect(screen.getByText('95% similar')).toBeInTheDocument();
  });

  it('calls onViewMatch with correct ID', () => {
    const handleViewMatch = vi.fn();
    render(
      <DedupWarning
        matches={defaultMatches}
        onViewMatch={handleViewMatch}
        onDismiss={vi.fn()}
      />,
    );

    const viewButtons = screen.getAllByText('View match');
    fireEvent.click(viewButtons[0]);
    expect(handleViewMatch).toHaveBeenCalledWith('item-1');

    fireEvent.click(viewButtons[1]);
    expect(handleViewMatch).toHaveBeenCalledWith('item-2');
  });

  it('calls onDismiss when dismiss clicked', () => {
    const handleDismiss = vi.fn();
    render(
      <DedupWarning
        matches={defaultMatches}
        onViewMatch={vi.fn()}
        onDismiss={handleDismiss}
      />,
    );

    const dismissButton = screen.getByLabelText('Dismiss duplicate warning');
    fireEvent.click(dismissButton);
    expect(handleDismiss).toHaveBeenCalledOnce();
  });

  it('has role="alert" on container', () => {
    render(
      <DedupWarning
        matches={defaultMatches}
        onViewMatch={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders nothing when matches array is empty', () => {
    const { container } = render(
      <DedupWarning matches={[]} onViewMatch={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
