/**
 * ReadinessChecklist component tests.
 *
 * Covers:
 *   - "Ready to export" banner when all pass
 *   - Issue count display when some fail
 *   - Expandable per-question issues
 *   - Refresh button
 *   - Loading state
 *   - Error state
 *   - ReadinessBadge component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ReadinessChecklist,
  ReadinessBadge,
} from '@/components/procurement/readiness-checklist';
import type { ReadinessData } from '@/hooks/bid/use-bid-readiness';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeReadyData(): ReadinessData {
  return {
    ready: true,
    summary: {
      total_questions: 5,
      answered: 5,
      approved: 5,
      quality_checked: 5,
      passing_quality: 5,
    },
    criteria: [
      {
        name: 'All questions answered',
        passed: true,
        details: '5 of 5 questions answered',
      },
      {
        name: 'All responses reviewed',
        passed: true,
        details: '5 of 5 responses approved or edited',
      },
      {
        name: 'Word limits met',
        passed: true,
        details: '5 of 5 within word limits',
      },
      {
        name: 'Quality threshold met',
        passed: true,
        details: '5 of 5 checked responses pass quality threshold',
      },
      {
        name: 'No unsupported claims',
        passed: true,
        details: '5 of 5 responses free of unsupported claims',
      },
      {
        name: 'Has citations',
        passed: true,
        details: '5 of 5 checked responses have citations',
      },
      {
        name: 'No critical issues',
        passed: true,
        details: '5 of 5 responses free of critical issues',
      },
    ],
    issues: [],
  };
}

function makeNotReadyData(): ReadinessData {
  return {
    ready: false,
    summary: {
      total_questions: 5,
      answered: 3,
      approved: 2,
      quality_checked: 3,
      passing_quality: 2,
    },
    criteria: [
      {
        name: 'All questions answered',
        passed: false,
        details: '3 of 5 questions answered',
      },
      {
        name: 'All responses reviewed',
        passed: false,
        details: '2 of 5 responses approved or edited',
      },
      {
        name: 'Word limits met',
        passed: true,
        details: '5 of 5 within word limits',
      },
      {
        name: 'Quality threshold met',
        passed: false,
        details: '2 of 3 checked responses pass quality threshold',
      },
      {
        name: 'No unsupported claims',
        passed: true,
        details: '5 of 5 responses free of unsupported claims',
      },
      {
        name: 'Has citations',
        passed: true,
        details: '3 of 3 checked responses have citations',
      },
      {
        name: 'No critical issues',
        passed: true,
        details: '5 of 5 responses free of critical issues',
      },
    ],
    issues: [
      {
        question_number: 4,
        question_title: 'Risk management approach',
        issues: ['No response drafted', 'No citations found'],
      },
      {
        question_number: 5,
        question_title: 'Team experience',
        issues: ['Review status: draft (requires approved or edited)'],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReadinessChecklist', () => {
  it('shows "Ready to export" when all criteria pass', () => {
    render(
      <ReadinessChecklist
        readiness={makeReadyData()}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Ready to export')).toBeInTheDocument();
    // All criteria should show as passed (CheckCircle icons)
    const list = screen.getByRole('list', { name: /readiness criteria/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(7);
  });

  it('shows failed criteria count when not ready', () => {
    render(
      <ReadinessChecklist
        readiness={makeNotReadyData()}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('3 criteria not met')).toBeInTheDocument();
  });

  it('shows expandable per-question issues', async () => {
    const user = userEvent.setup();

    render(
      <ReadinessChecklist
        readiness={makeNotReadyData()}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    // Issues should be collapsed by default
    const expandButton = screen.getByRole('button', {
      name: /2 questions with issues/i,
    });
    expect(expandButton).toBeInTheDocument();

    // Expand
    await user.click(expandButton);

    // Should show per-question issues
    expect(
      screen.getByText(/Q4: Risk management approach/),
    ).toBeInTheDocument();
    expect(screen.getByText('No response drafted')).toBeInTheDocument();
    expect(screen.getByText(/Q5: Team experience/)).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button clicked', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();

    render(
      <ReadinessChecklist
        readiness={makeReadyData()}
        isLoading={false}
        error={null}
        onRefresh={onRefresh}
      />,
    );

    const refreshButton = screen.getByRole('button', {
      name: /refresh readiness check/i,
    });
    await user.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows loading state', () => {
    render(
      <ReadinessChecklist
        readiness={null}
        isLoading={true}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Checking readiness...')).toBeInTheDocument();
  });

  it('shows error state with retry', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();

    render(
      <ReadinessChecklist
        readiness={null}
        isLoading={false}
        error="Network error"
        onRefresh={onRefresh}
      />,
    );

    expect(
      screen.getByText(/Could not check readiness: Network error/),
    ).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /retry/i });
    await user.click(retryButton);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows summary statistics', () => {
    render(
      <ReadinessChecklist
        readiness={makeNotReadyData()}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('3/5 answered')).toBeInTheDocument();
    expect(screen.getByText('2/5 approved')).toBeInTheDocument();
    expect(screen.getByText('2/3 passing quality')).toBeInTheDocument();
  });
});

describe('ReadinessBadge', () => {
  it('shows "Ready" badge when ready', () => {
    render(<ReadinessBadge readiness={makeReadyData()} isLoading={false} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('shows issue count when not ready', () => {
    render(<ReadinessBadge readiness={makeNotReadyData()} isLoading={false} />);
    expect(screen.getByText('3 issues')).toBeInTheDocument();
  });

  it('renders nothing when loading', () => {
    const { container } = render(
      <ReadinessBadge readiness={null} isLoading={true} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no data', () => {
    const { container } = render(
      <ReadinessBadge readiness={null} isLoading={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows singular "issue" for single failure', () => {
    const data = makeNotReadyData();
    // Keep only 1 failing criterion
    data.criteria = data.criteria.map((c, i) =>
      i === 0 ? { ...c, passed: false } : { ...c, passed: true },
    );
    render(<ReadinessBadge readiness={data} isLoading={false} />);
    expect(screen.getByText('1 issue')).toBeInTheDocument();
  });
});
