'use client';

import { useState } from 'react';
import {
  ActivityFeed,
  type ActivityEventFilter,
  type ActivityDateRange,
} from '@/components/activity-feed';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function ActivitySection() {
  const [eventFilter, setEventFilter] = useState<ActivityEventFilter>('all');
  const [dateRange, setDateRange] = useState<ActivityDateRange>('all');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold">Activity Log</h3>
        <p className="text-sm text-muted-foreground">
          Recent edits, rollbacks, and quality events across the knowledge base.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={eventFilter}
          onValueChange={(v) => setEventFilter(v as ActivityEventFilter)}
        >
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="content">Content</SelectItem>
            <SelectItem value="governance">Governance</SelectItem>
            <SelectItem value="bid">Bid</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={dateRange}
          onValueChange={(v) => setDateRange(v as ActivityDateRange)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This week</SelectItem>
            <SelectItem value="month">This month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ActivityFeed eventFilter={eventFilter} dateRange={dateRange} />
    </div>
  );
}
