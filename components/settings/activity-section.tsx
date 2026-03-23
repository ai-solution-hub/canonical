'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
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
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

export function ActivitySection() {
  const [eventFilter, setEventFilter] = useState<ActivityEventFilter>('all');
  const [dateRange, setDateRange] = useState<ActivityDateRange>('all');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          Activity Log
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="More information about activity log"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Shows content edits, governance events (reviews, approvals), bid
                actions, and system events. Filter by type or date range to find
                specific changes. Activity is read-only — it is an audit trail.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h3>
        <p className="text-sm text-muted-foreground">
          A log of recent changes — who edited what, when, and why.
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
