import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { logBestEffortWarn, logSwallowedError } from '@/lib/supabase/telemetry';

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('logBestEffortWarn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('emits a Sentry breadcrumb', () => {
    logBestEffortWarn('items.owner.notify', 'boom', { id: 1 });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'items.owner.notify',
        message: 'boom',
        level: 'warning',
        data: { id: 1 },
      }),
    );
  });

  it('also writes a console.warn for dev visibility', () => {
    const spy = vi.spyOn(console, 'warn');
    logBestEffortWarn('x.y', 'msg');
    expect(spy).toHaveBeenCalledWith('[x.y] msg', undefined);
  });
});

describe('logSwallowedError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('captures a Sentry message when severity is elevated', () => {
    logSwallowedError('gov.check', new Error('boom'), { severity: 'elevated' });
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });

  it('does not capture a message at normal severity', () => {
    logSwallowedError('gov.check', new Error('boom'));
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalled();
  });
});
