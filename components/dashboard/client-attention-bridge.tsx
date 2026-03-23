'use client';

import { useState, useCallback } from 'react';
import { NeedsAttentionSection } from './needs-attention-section';
import { ComplianceStatusSection } from './compliance-status-section';
import { ExpiringContentSection } from './expiring-content-section';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientAttentionBridgeProps {
  /** Server-side attention data from fetchDashboardData() */
  needsAttention: {
    governance_review_count: number | null;
    unverified_count: number | null;
    quality_flag_count: number | null;
    stale_content_count: number | null;
    expired_content_count: number | null;
  };
  /** User role for role-based card visibility */
  userRole: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client-side bridge that wires the `onExpiringCountChange` callbacks
 * from ComplianceStatusSection and ExpiringContentSection into
 * NeedsAttentionSection.
 *
 * The parent page is a Server Component, so it cannot hold React state.
 * This bridge component manages the client-side count state and passes
 * it through as props.
 */
export function ClientAttentionBridge({
  needsAttention,
  userRole,
}: ClientAttentionBridgeProps) {
  const [expiringCertCount, setExpiringCertCount] = useState<number>(0);
  const [expiringContentCount, setExpiringContentCount] = useState<number>(0);

  const handleExpiringCertCountChange = useCallback((count: number) => {
    setExpiringCertCount(count);
  }, []);

  const handleExpiringContentCountChange = useCallback((count: number) => {
    setExpiringContentCount(count);
  }, []);

  return (
    <>
      {/* NeedsAttentionSection receives both server-side counts and
          client-side counts from the compliance/expiring sections */}
      <NeedsAttentionSection
        {...needsAttention}
        expiringCertCount={expiringCertCount}
        expiringContentCount={expiringContentCount}
        userRole={userRole}
      />

      {/* Compliance Status — fires onExpiringCountChange when data loads */}
      <div className="mt-6">
        <ComplianceStatusSection
          onExpiringCountChange={handleExpiringCertCountChange}
        />
      </div>

      {/* Expiring Content — fires onExpiringCountChange when data loads */}
      <div className="mt-6">
        <ExpiringContentSection
          onExpiringCountChange={handleExpiringContentCountChange}
        />
      </div>
    </>
  );
}
