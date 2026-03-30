/**
 * Vitest global setup file.
 * Registers jest-dom matchers and provides polyfills for jsdom.
 * Skips browser polyfills when running in node environment (e.g. real DB integration tests).
 */
import '@testing-library/jest-dom/vitest';

// Skip browser polyfills in node environment (real DB integration tests use @vitest-environment node)
if (typeof window === 'undefined') {
  // Nothing to polyfill in node
} else {

// Polyfill matchMedia (not provided by jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Stub IntersectionObserver (not provided by jsdom)
class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: ReadonlyArray<number> = [0];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

// Stub ResizeObserver (not provided by jsdom)
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});

} // end if (typeof window !== 'undefined')
