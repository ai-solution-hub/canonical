'use client';

import { useParams } from 'next/navigation';
import { MetricsDashboard } from '@/components/intelligence/metrics-dashboard';

export default function MetricsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">
          Workspace Metrics
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Track filter performance trends and per-prompt-version accuracy over
          time.
        </p>
      </div>

      <MetricsDashboard workspaceId={workspaceId} />
    </div>
  );
}
