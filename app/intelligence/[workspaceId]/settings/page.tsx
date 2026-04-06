'use client';

import { useParams } from 'next/navigation';
import { WorkspaceSettings } from '@/components/intelligence/workspace-settings';

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-foreground">
          Workspace Settings
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure scoring behaviour and other workspace-level options.
        </p>
      </header>
      <WorkspaceSettings workspaceId={workspaceId} />
    </div>
  );
}
