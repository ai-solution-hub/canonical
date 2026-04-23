'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/query/fetchers';
import type { NotificationPreferences as NotificationPreferencesType } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Switch row definitions
// ---------------------------------------------------------------------------

interface PrefSwitch {
  key: keyof Pick<
    NotificationPreferencesType,
    | 'email_weekly_change_report'
    | 'email_review_assigned'
    | 'email_owned_content_flagged'
    | 'auto_generate_change_reports'
  >;
  label: string;
  description: string;
}

const PREF_SWITCHES: PrefSwitch[] = [
  {
    key: 'email_weekly_change_report',
    label: 'Weekly Change Report',
    description: 'Email digest of knowledge base changes each week',
  },
  {
    key: 'email_review_assigned',
    label: 'Review assignments',
    description: 'Email when a review is assigned to you',
  },
  {
    key: 'email_owned_content_flagged',
    label: 'Owned content flags',
    description: 'Email when content you own gets flagged for review',
  },
  {
    key: 'auto_generate_change_reports',
    label: 'Auto-generate weekly Change Reports',
    description:
      'Automatically generate a weekly Change Report on your first visit to Change Reports',
  },
];

/** Default preferences when the server has no row for this user. */
const DEFAULTS: Pick<
  NotificationPreferencesType,
  | 'email_weekly_change_report'
  | 'email_review_assigned'
  | 'email_owned_content_flagged'
  | 'auto_generate_change_reports'
> = {
  email_weekly_change_report: true,
  email_review_assigned: true,
  email_owned_content_flagged: true,
  auto_generate_change_reports: true,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationPreferences() {
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: queryKeys.notifications.preferences,
    queryFn: fetchNotificationPreferences,
  });

  const mutation = useMutation({
    mutationFn: updateNotificationPreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.preferences,
      });
      toast.success('Notification preferences updated');
    },
    onError: () => {
      toast.error('Failed to update notification preferences');
    },
  });

  // Merge server data with defaults for display
  const current = {
    ...DEFAULTS,
    ...(prefs ?? {}),
  };

  function handleToggle(key: PrefSwitch['key'], checked: boolean) {
    mutation.mutate({ [key]: checked });
  }

  return (
    <Card className="p-6">
      <h3 className="mb-1 flex items-center gap-1.5 text-base font-semibold">
        <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
        Notifications
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Choose which email notifications you receive.
      </p>

      <div className="flex flex-col gap-4">
        {PREF_SWITCHES.map((pref) => {
          const switchId = `notification-pref-${pref.key}`;
          return (
            <div
              key={pref.key}
              className="flex items-start justify-between gap-4"
            >
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={switchId} className="text-sm font-medium">
                  {pref.label}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {pref.description}
                </p>
              </div>
              {isLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  id={switchId}
                  checked={current[pref.key]}
                  onCheckedChange={(checked: boolean) =>
                    handleToggle(pref.key, checked)
                  }
                  disabled={mutation.isPending}
                  aria-label={pref.label}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
