'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CertificationSummaryCard,
  type CertificationEntry,
  type RegistrationEntry,
} from '@/components/dashboard/certification-summary-card';
import {
  FrameworkSummaryCard,
  type FrameworkEntry,
} from '@/components/dashboard/framework-summary-card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CertificationReport {
  certifications: CertificationEntry[];
  frameworks: FrameworkEntry[];
  registrations: RegistrationEntry[];
  summary: {
    total_certifications: number;
    valid: number;
    expiring_soon: number;
    expired: number;
    unknown: number;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dashboard section showing compliance status — certifications,
 * frameworks, and registrations aggregated from entity data.
 *
 * Fetches from /api/certifications on mount.
 */
export function ComplianceStatusSection() {
  const [data, setData] = useState<CertificationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/certifications');
        if (!response.ok) {
          throw new Error('Failed to load certification data');
        }
        const report: CertificationReport = await response.json();
        if (!cancelled) {
          setData(report);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load certification data',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <section
        aria-label="Compliance status"
        className="rounded-lg border bg-card p-4"
      >
        <div className="flex items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error) {
    return (
      <section
        aria-label="Compliance status"
        className="rounded-lg border bg-card p-4"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Compliance Status
        </h2>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <AlertTriangle
            className="size-4 shrink-0 text-status-warning"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            Could not load compliance data. Try refreshing the page.
          </p>
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Empty state — no certifications at all
  // -------------------------------------------------------------------------

  if (
    !data ||
    (data.certifications.length === 0 &&
      data.frameworks.length === 0 &&
      data.registrations.length === 0)
  ) {
    return null;
  }

  // -------------------------------------------------------------------------
  // Separate self-held and supplier certifications
  // -------------------------------------------------------------------------

  const selfCerts = data.certifications.filter((c) => c.holder === 'self');
  const supplierCerts = data.certifications.filter(
    (c) => c.holder === 'supplier',
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section
      aria-label="Compliance status"
      id="compliance-status"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="size-4" aria-hidden="true" />
        Compliance Status
        {data.summary.expiring_soon > 0 && (
          <span
            className="ml-1 inline-flex items-center rounded-full bg-freshness-aging-bg px-2 py-0.5 text-xs font-medium text-freshness-aging"
            aria-label={`${data.summary.expiring_soon} expiring soon`}
          >
            {data.summary.expiring_soon} expiring
          </span>
        )}
      </h2>

      <div className="space-y-4">
        <CertificationSummaryCard
          certifications={selfCerts}
          supplierCertifications={supplierCerts}
          registrations={data.registrations}
        />

        <FrameworkSummaryCard frameworks={data.frameworks} />
      </div>
    </section>
  );
}
