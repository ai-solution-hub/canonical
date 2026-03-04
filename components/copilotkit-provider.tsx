'use client';

import { CopilotKit } from '@copilotkit/react-core';
import '@copilotkit/react-ui/styles.css';
import { ReactNode, Component } from 'react';
import { AlertTriangle } from 'lucide-react';

// ────────────────────────────────────────────
// Error Boundary
// ────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that catches CopilotKit runtime errors (network failures,
 * invalid responses, etc.) and prevents them from crashing the bid workspace.
 * Displays an accessible warning banner while keeping the rest of the workspace functional.
 */
class CopilotKitErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[CopilotKit] Error caught by boundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <>
          <div
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span>AI assistant temporarily unavailable</span>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="ml-auto rounded px-2 py-0.5 text-xs underline hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:hover:bg-amber-900"
              >
                Try again
              </button>
            </div>
          </div>
          {this.props.children}
        </>
      );
    }
    return this.props.children;
  }
}

// ────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────

interface CopilotKitProviderProps {
  children: ReactNode;
}

/**
 * CopilotKit provider scoped to the bid workspace.
 *
 * Wraps children with the CopilotKit context and an error boundary.
 * The runtimeUrl points to the Next.js API route at /api/copilotkit.
 */
export function CopilotKitProvider({ children }: CopilotKitProviderProps) {
  return (
    <CopilotKitErrorBoundary>
      <CopilotKit runtimeUrl="/api/copilotkit">
        {children}
      </CopilotKit>
    </CopilotKitErrorBoundary>
  );
}
