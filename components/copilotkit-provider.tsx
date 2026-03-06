'use client';

import { CopilotKit } from '@copilotkit/react-core';
import '@copilotkit/react-ui/styles.css';
import { ReactNode, Component, useState, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

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
// Unavailable Banner
// ────────────────────────────────────────────

function UnavailableBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        <span>AI assistant unavailable — bid workspace is fully functional without it</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-auto rounded p-0.5 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:hover:bg-amber-900"
          aria-label="Dismiss"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────
// Connection Health Check Hook
// ────────────────────────────────────────────

type HealthStatus = 'checking' | 'available' | 'unavailable';

function useCopilotHealthCheck(): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>('checking');
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    let cancelled = false;

    // Use HEAD request to check if the endpoint is reachable without
    // triggering a 400 error in the console from an empty POST body.
    // If HEAD is not allowed (405), the endpoint is still reachable.
    fetch('/api/copilotkit', { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return;
        // 5xx = server error = endpoint down
        // Any other status (200, 400, 404, 405) = endpoint reachable
        setStatus(res.status >= 500 ? 'unavailable' : 'available');
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable');
      });

    return () => { cancelled = true; };
  }, []);

  return status;
}

// ────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────

interface CopilotKitProviderProps {
  children: ReactNode;
}

/**
 * CopilotKit provider scoped to the bid session page.
 *
 * Performs a lightweight health check against /api/copilotkit before
 * mounting the CopilotKit component. If the endpoint is unreachable
 * or returns a server error, renders children directly with a
 * dismissible warning banner instead of entering an infinite retry loop.
 */
export function CopilotKitProvider({ children }: CopilotKitProviderProps) {
  const health = useCopilotHealthCheck();

  // Always wrap children in CopilotKit so hooks (useCopilotReadable,
  // useCopilotAction, etc.) and CopilotSidebar never mount without a
  // provider context. The CopilotKit component is lightweight — it only
  // sets up React context. Actual network calls happen on user interaction.
  return (
    <CopilotKitErrorBoundary>
      <CopilotKit runtimeUrl="/api/copilotkit">
        {health === 'unavailable' && <UnavailableBanner />}
        {children}
      </CopilotKit>
    </CopilotKitErrorBoundary>
  );
}
