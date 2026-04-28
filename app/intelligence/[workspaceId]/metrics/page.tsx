'use client';

import { useParams } from 'next/navigation';
import { MetricsDashboard } from '@/components/intelligence/metrics-dashboard';

export default function MetricsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">
          See how your workspace is performing — what&apos;s getting through,
          what&apos;s being filtered out, and how your filter rules are
          evolving.
        </p>
      </div>

      <MetricsDashboard workspaceId={workspaceId} />
    </div>
  );
}
