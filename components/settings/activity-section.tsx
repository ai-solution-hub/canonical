'use client';

import { ActivityFeed } from '@/components/activity-feed';

export function ActivitySection() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold">Activity Log</h3>
        <p className="text-sm text-muted-foreground">
          Recent edits, rollbacks, and quality events across the knowledge base.
        </p>
      </div>
      <ActivityFeed />
    </div>
  );
}
