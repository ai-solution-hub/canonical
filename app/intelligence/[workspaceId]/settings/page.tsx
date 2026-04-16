'use client';

import { useParams } from 'next/navigation';
import { WorkspaceSettings } from '@/components/intelligence/workspace-settings';
import { ConceptHelp } from '@/components/ui/concept-help';

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
          Workspace Settings
          <ConceptHelp concept="workspace" />
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure scoring behaviour and other workspace-level options.
        </p>
      </header>
      <WorkspaceSettings workspaceId={workspaceId} />
    </div>
  );
}
