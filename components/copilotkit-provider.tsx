'use client';

import { CopilotKit } from '@copilotkit/react-core';
import '@copilotkit/react-ui/styles.css';
import { ReactNode, Component, useState, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useHydrated } from '@/hooks/use-hydrated';

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
            className="rounded-md border border-status-warning bg-quality-moderate-bg p-3 text-sm text-status-warning"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span>AI assistant temporarily unavailable</span>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="ml-auto rounded px-2 py-0.5 text-xs underline hover:bg-freshness-aging-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning focus-visible:ring-offset-2"
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
      className="rounded-md border border-status-warning bg-quality-moderate-bg p-3 text-sm text-status-warning"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        <span>AI assistant unavailable — bid workspace is fully functional without it</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-auto rounded p-0.5 hover:bg-freshness-aging-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning focus-visible:ring-offset-2"
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
 * CopilotKit provider with health check and hydration guard.
 *
 * Defers mounting until after hydration to avoid React error #418:
 * CopilotKit's ThreadsProvider calls `crypto.randomUUID()` inside
 * `useState`, producing a different value on server vs client.
 * During SSR / initial hydration we render children directly.
 *
 * Also performs a lightweight health check against /api/copilotkit before
 * mounting the CopilotKit component. If the endpoint is unreachable
 * or returns a server error, renders children with a dismissible
 * warning banner instead of entering an infinite retry loop.
 */
export function CopilotKitProvider({ children }: CopilotKitProviderProps) {
  const hydrated = useHydrated();
  const health = useCopilotHealthCheck();

  // Before hydration, render children without CopilotKit context.
  // Hooks like useCopilotReadable are only called inside components
  // that themselves wait for hydration (GlobalCopilotSidebar, etc.),
  // so this is safe.
  if (!hydrated) {
    return <>{children}</>;
  }

  return (
    <CopilotKitErrorBoundary>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        showDevConsole={false}
        enableInspector={false}
      >
        {health === 'unavailable' && <UnavailableBanner />}
        {children}
      </CopilotKit>
    </CopilotKitErrorBoundary>
  );
}
