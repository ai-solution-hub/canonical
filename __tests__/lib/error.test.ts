import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeErrorMessage } from '@/lib/error';

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

describe('safeErrorMessage', () => {
  it('returns just the fallback in production', () => {
    process.env.NODE_ENV = 'production';
    const result = safeErrorMessage(
      new Error('secret details'),
      'Something went wrong',
    );
    expect(result).toBe('Something went wrong');
  });

  it('includes the error message in development for Error instances', () => {
    process.env.NODE_ENV = 'development';
    const result = safeErrorMessage(new Error('db timeout'), 'Failed to load');
    expect(result).toBe('Failed to load: db timeout');
  });

  it('returns just the fallback in development for non-Error objects', () => {
    process.env.NODE_ENV = 'development';
    const result = safeErrorMessage('a plain string error', 'Operation failed');
    expect(result).toBe('Operation failed');
  });

  it('returns just the fallback when NODE_ENV is undefined (non-development)', () => {
    process.env.NODE_ENV = undefined as unknown as string;
    const result = safeErrorMessage(new Error('oops'), 'Server error');
    expect(result).toBe('Server error');
  });

  it('always calls console.error with the fallback and error', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('kaboom');
    safeErrorMessage(err, 'Request failed');
    expect(console.error).toHaveBeenCalledWith('Request failed', err);
  });

  it('calls console.error in development as well', () => {
    process.env.NODE_ENV = 'development';
    const err = { code: 42 };
    safeErrorMessage(err, 'Unexpected error');
    expect(console.error).toHaveBeenCalledWith('Unexpected error', err);
  });
});
