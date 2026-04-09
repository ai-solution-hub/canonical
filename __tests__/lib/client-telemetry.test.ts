import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @sentry/nextjs before importing the module under test
const mockSetTag = vi.fn();
const mockSetExtra = vi.fn();
const mockCaptureException = vi.fn();
const mockWithScope = vi.fn((cb: (scope: unknown) => void) => {
  cb({ setTag: mockSetTag, setExtra: mockSetExtra });
});

vi.mock('@sentry/nextjs', () => ({
  withScope: (cb: (scope: unknown) => void) => mockWithScope(cb),
  captureException: (err: unknown) => mockCaptureException(err),
}));

import { captureClientException } from '@/lib/client-telemetry';

describe('captureClientException', () => {
  beforeEach(() => {
    mockSetTag.mockClear();
    mockSetExtra.mockClear();
    mockCaptureException.mockClear();
    mockWithScope.mockClear();
    // Default: withScope succeeds
    mockWithScope.mockImplementation((cb: (scope: unknown) => void) => {
      cb({ setTag: mockSetTag, setExtra: mockSetExtra });
    });
  });

  it('calls Sentry.withScope with a scope tag', () => {
    const err = new Error('boom');
    captureClientException(err, {
      scope: 'item-detail.test.action',
    });

    expect(mockWithScope).toHaveBeenCalledTimes(1);
    expect(mockSetTag).toHaveBeenCalledWith(
      'ui.scope',
      'item-detail.test.action',
    );
  });

  it('passes the error to Sentry.captureException', () => {
    const err = new Error('boom');
    captureClientException(err, {
      scope: 'item-detail.test.action',
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(err);
  });

  it('sets an extra for every key in extras', () => {
    const err = new Error('boom');
    captureClientException(err, {
      scope: 'item-detail.test.action',
      extras: {
        itemId: 'abc-123',
        retryCount: 3,
        userInput: 'hello',
      },
    });

    expect(mockSetExtra).toHaveBeenCalledTimes(3);
    expect(mockSetExtra).toHaveBeenCalledWith('itemId', 'abc-123');
    expect(mockSetExtra).toHaveBeenCalledWith('retryCount', 3);
    expect(mockSetExtra).toHaveBeenCalledWith('userInput', 'hello');
  });

  it('omits setExtra when extras is not provided', () => {
    const err = new Error('boom');
    captureClientException(err, {
      scope: 'item-detail.test.action',
    });

    expect(mockSetExtra).not.toHaveBeenCalled();
  });

  it('does not propagate when Sentry throws', () => {
    mockWithScope.mockImplementation(() => {
      throw new Error('sentry offline');
    });

    const err = new Error('boom');

    // Must not throw
    expect(() =>
      captureClientException(err, {
        scope: 'item-detail.test.action',
      }),
    ).not.toThrow();
  });

  it('handles non-Error values', () => {
    captureClientException('a plain string error', {
      scope: 'item-detail.test.stringError',
    });

    expect(mockCaptureException).toHaveBeenCalledWith('a plain string error');
  });
});
