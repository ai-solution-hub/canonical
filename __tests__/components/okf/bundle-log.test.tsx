import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BundleLog } from '@/components/okf/bundle-log';

describe('BundleLog', () => {
  it('renders entries reverse-chronologically as given (no re-sorting)', () => {
    render(
      <BundleLog
        entries={[
          { heading: '2026-07-05T14:30:00Z', body: '- Changed `soc2`.' },
          { heading: '2026-07-01T09:00:00Z', body: '- Added `standard`.' },
        ]}
      />,
    );

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      '2026-07-05T14:30:00Z',
      '2026-07-01T09:00:00Z',
    ]);
  });

  it('renders each entry body as markdown', () => {
    render(
      <BundleLog
        entries={[
          { heading: '2026-07-01T09:00:00Z', body: '- Added `standard`.' },
        ]}
      />,
    );

    expect(screen.getByRole('listitem')).toHaveTextContent('Added standard.');
  });

  it('renders an unheaded entry without a heading element', () => {
    render(<BundleLog entries={[{ heading: '', body: 'Freeform note.' }]} />);

    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.getByText('Freeform note.')).toBeInTheDocument();
  });

  it('renders an empty state with no entries', () => {
    render(<BundleLog entries={[]} />);

    expect(screen.getByText(/No run history recorded yet/)).toBeInTheDocument();
  });

  it('never renders an edit/accept/reject affordance (read-only, ID-135 out of scope)', () => {
    render(
      <BundleLog
        entries={[
          { heading: '2026-07-01T09:00:00Z', body: '- Added `standard`.' },
        ]}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
