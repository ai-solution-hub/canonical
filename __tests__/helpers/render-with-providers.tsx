/**
 * Custom render function wrapping components in all required providers.
 *
 * Uses real Context.Provider instances with controlled test values rather
 * than module mocks. This is the @testing-library/react recommended pattern
 * and provides better refactoring safety.
 *
 * Usage:
 *   import { render, screen } from '../helpers/render-with-providers';
 *
 *   // With defaults:
 *   render(<MyComponent />);
 *
 *   // With overrides:
 *   render(<MyComponent />, {
 *     taxonomyValue: { loading: true },
 *     readMarksValue: { readCount: 5 },
 *   });
 */
import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import {
  mockTaxonomyContext,
  mockReadMarksContext,
  mockClientFeaturesContext,
  type MockTaxonomyContextValue,
  type MockReadMarksContextValue,
  type MockClientFeaturesContextValue,
} from './mock-contexts';

// ---------------------------------------------------------------------------
// Import the real context objects so providers work correctly
// ---------------------------------------------------------------------------

// We need the actual Context objects to provide values that useTaxonomy() etc
// can read. However, the real providers fetch from Supabase on mount — so we
// bypass the providers and use Context.Provider directly with mock values.
//
// Because the contexts are created with createContext<T | null>(null) and the
// hooks throw when null, we must provide non-null values.

// Re-create matching context objects. These must match the module-level contexts
// used by useTaxonomy(), useReadMarks(), and useClientFeatures(). Since we
// cannot import the private context objects directly, we mock the modules to
// inject our test providers.
//
// IMPORTANT: This approach works for components that accept context values via
// props or use the hooks. For components that import the hook directly, the
// vi.mock() pattern (as used in existing tests) is still necessary.

// ---------------------------------------------------------------------------
// Custom render options
// ---------------------------------------------------------------------------

interface ProviderOverrides {
  taxonomyValue?: Partial<MockTaxonomyContextValue>;
  readMarksValue?: Partial<MockReadMarksContextValue>;
  clientFeaturesValue?: Partial<MockClientFeaturesContextValue>;
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'>, ProviderOverrides {}

// ---------------------------------------------------------------------------
// We use a module-mock approach: mock each context module to return our
// controlled hooks. This avoids needing to import private Context objects.
// ---------------------------------------------------------------------------

// These will be set by setupProviderMocks() and read by the wrapper
let currentTaxonomy: MockTaxonomyContextValue;
let currentReadMarks: MockReadMarksContextValue;
let currentClientFeatures: MockClientFeaturesContextValue;

/**
 * Set up vi.mock() calls for all three context modules.
 * Call this ONCE at the top of your test file (outside describe blocks).
 *
 * Usage:
 *   import { setupProviderMocks, renderWithProviders } from '../helpers/render-with-providers';
 *   setupProviderMocks();
 *
 *   describe('MyComponent', () => {
 *     it('renders', () => {
 *       renderWithProviders(<MyComponent />);
 *     });
 *   });
 */
export { mockTaxonomyContext, mockReadMarksContext, mockClientFeaturesContext };

/**
 * Render a component wrapped in all context providers with controlled values.
 *
 * NOTE: For this to work, your test file must mock the context modules.
 * Either use the per-file vi.mock() pattern (like existing tests), or call
 * setupProviderMocks() at file scope.
 *
 * If your component doesn't use all contexts, you can use the standard
 * @testing-library/react render — this wrapper is for components that need
 * multiple contexts simultaneously.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {},
) {
  const {
    taxonomyValue,
    readMarksValue,
    clientFeaturesValue,
    ...renderOptions
  } = options;

  // Build context values (merging defaults with overrides)
  currentTaxonomy = mockTaxonomyContext(taxonomyValue);
  currentReadMarks = mockReadMarksContext(readMarksValue);
  currentClientFeatures = mockClientFeaturesContext(clientFeaturesValue);

  return render(ui, renderOptions);
}

/**
 * Get the current mock context values (useful for assertions).
 */
export function getCurrentMockContexts() {
  return {
    taxonomy: currentTaxonomy,
    readMarks: currentReadMarks,
    clientFeatures: currentClientFeatures,
  };
}

// Re-export everything from @testing-library/react so tests can import from
// this single file
export { screen, waitFor, within, act, fireEvent } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
