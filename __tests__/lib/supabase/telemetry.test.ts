import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';

// WP2 (S19): lib/supabase/telemetry.ts now routes the swallow-warning log
// through @/lib/logger/client (logger.warn) instead of console.warn.
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@/lib/logger/client', () => ({
  logger: loggerMocks,
}));

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}));

import { logBestEffortWarn, logSwallowedError } from '@/lib/supabase/telemetry';

describe('logBestEffortWarn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggerMocks.warn.mockClear();
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

  it('also writes a structured logger.warn for dev visibility', () => {
    logBestEffortWarn('x.y', 'msg');
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'x.y' }),
      'msg',
    );
  });
});

describe('logSwallowedError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggerMocks.warn.mockClear();
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
