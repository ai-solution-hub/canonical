/**
 * Date-extraction UI — design-system contract test.
 *
 * This is the SINGLE intentional coupling point between the expiry/temporal
 * date UI and the Warm Meridian freshness semantic tokens. The behaviour suite
 * (date-extraction-ui.test.tsx) asserts user-observable state (the "Expired" /
 * "N days remaining" label, the "Expiry"/"Effective"/"Historical" type badges,
 * aria-labels); this file alone pins the urgency-tier -> freshness-token
 * mapping, so a token rename surfaces here rather than scattered across the
 * behaviour tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// cn must concatenate (not de-dupe via tailwind-merge) so the token classes
// the component composes remain assertable — matches the behaviour suite mock.
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ExpiryDateDisplay } from '@/components/shared/expiry-date-display';
import { TemporalReferencesSection } from '@/components/item-detail/temporal-references-section';

describe('ExpiryDateDisplay — freshness-token contract', () => {
  it('maps an expired date to the expired freshness token', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2020-01-01" lifecycleType={null} />
      </dl>,
    );
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('freshness-expired');
  });

  it('maps an imminent expiry (<=7 days) to the stale freshness token', () => {
    const fixedTimestamp = new Date('2026-06-23T12:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const isoDate = futureDate.toISOString().split('T')[0];

    render(
      <dl>
        <ExpiryDateDisplay expiryDate={isoDate} lifecycleType={null} />
      </dl>,
    );
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('freshness-stale');

    vi.restoreAllMocks();
  });

  it('maps an approaching expiry (<=30 days) to the aging freshness token', () => {
    const fixedTimestamp = new Date('2026-06-23T12:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 20);
    const isoDate = futureDate.toISOString().split('T')[0];

    render(
      <dl>
        <ExpiryDateDisplay expiryDate={isoDate} lifecycleType={null} />
      </dl>,
    );
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('freshness-aging');

    vi.restoreAllMocks();
  });
});

describe('TemporalReferencesSection — freshness-token contract', () => {
  const expiryRef = {
    date: '2026-06-15',
    type: 'expiry' as const,
    confidence: 'high' as const,
    context: '...ISO 27001 certificate expires 15/06/2026...',
  };

  it('maps the expiry type badge to the stale freshness token, never a raw Tailwind colour', async () => {
    const user = userEvent.setup();
    render(<TemporalReferencesSection temporalReferences={[expiryRef]} />);

    await user.click(screen.getByRole('button', { name: /extracted dates/i }));

    const expiryBadge = screen.getByText('Expiry');
    expect(expiryBadge.className).toContain('freshness-stale');
    expect(expiryBadge.className).not.toMatch(
      /text-(red|orange|amber|green|blue)-\d/,
    );
  });
});
