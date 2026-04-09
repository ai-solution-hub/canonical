/**
 * ItemCompletenessChecklist Component Tests
 *
 * Editor-sidebar checklist replacing the retired `Curated` trust tier.
 * Asserts three completeness states: all complete, none complete, mixed.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { ItemCompletenessChecklist } from '@/components/item-detail/item-completeness-checklist';

function countComplete(container: HTMLElement): number {
  return container.querySelectorAll('li[data-complete="true"]').length;
}

function countIncomplete(container: HTMLElement): number {
  return container.querySelectorAll('li[data-complete="false"]').length;
}

describe('ItemCompletenessChecklist', () => {
  it('renders all three signals as complete when fully populated', () => {
    const { container } = render(
      <ItemCompletenessChecklist
        brief="Executive summary"
        detail="Detailed content"
        contentOwnerId="user-123"
      />,
    );
    expect(screen.getByText('Has a brief summary')).toBeInTheDocument();
    expect(screen.getByText('Has detailed content')).toBeInTheDocument();
    expect(screen.getByText('Has a content owner')).toBeInTheDocument();

    expect(countComplete(container)).toBe(3);
    expect(countIncomplete(container)).toBe(0);
  });

  it('renders all three signals as incomplete when nothing is populated', () => {
    const { container } = render(
      <ItemCompletenessChecklist
        brief={null}
        detail={null}
        contentOwnerId={null}
      />,
    );
    expect(countComplete(container)).toBe(0);
    expect(countIncomplete(container)).toBe(3);
  });

  it('renders mixed state with partial completeness', () => {
    const { container } = render(
      <ItemCompletenessChecklist
        brief="Executive summary"
        detail={null}
        contentOwnerId="user-123"
      />,
    );
    expect(countComplete(container)).toBe(2);
    expect(countIncomplete(container)).toBe(1);
  });

  it('has an accessible labelled region', () => {
    render(
      <ItemCompletenessChecklist
        brief={null}
        detail={null}
        contentOwnerId={null}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Item completeness' }),
    ).toBeInTheDocument();
  });

  it('empty string brief is treated as incomplete', () => {
    const { container } = render(
      <ItemCompletenessChecklist
        brief=""
        detail="Detailed content"
        contentOwnerId="user-123"
      />,
    );
    expect(countComplete(container)).toBe(2);
    expect(countIncomplete(container)).toBe(1);
  });
});
