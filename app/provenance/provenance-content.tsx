'use client';

import { Suspense, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { FileSearch, Loader2 } from 'lucide-react';
import { useUserRole } from '@/hooks/use-user-role';
import { AccessDenied } from '@/components/provenance/access-denied';
import {
  PROVENANCE_TABS,
  type ProvenanceTabId,
} from '@/components/provenance/tab-ids';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TAB = PROVENANCE_TABS.find((t) => t.default)!.id;
const VALID_TAB_IDS = new Set<string>(PROVENANCE_TABS.map((t) => t.id));

function isValidTab(value: string | null): value is ProvenanceTabId {
  return value !== null && VALID_TAB_IDS.has(value);
}

// ---------------------------------------------------------------------------
// Tab loading fallback
// ---------------------------------------------------------------------------

function TabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-4 space-y-3">
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-3/4 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder for tabs whose content modules do not exist yet
// ---------------------------------------------------------------------------

function TabPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-center">
      <p className="text-muted-foreground">{label} — coming soon</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dynamic tab content imports — graceful fallback when module is missing
// ---------------------------------------------------------------------------

const PerItemTab = dynamic(
  () =>
    import('@/components/provenance/per-item-tab').catch(() => ({
      default: () => <TabPlaceholder label="Per-item" />,
    })),
  { loading: () => <TabSkeleton /> },
);

const PipelineHealthTab = dynamic(
  () =>
    import('@/components/provenance/pipeline-health-tab').catch(() => ({
      default: () => <TabPlaceholder label="Pipeline Health" />,
    })),
  { loading: () => <TabSkeleton /> },
);

const AuditTab = dynamic(
  () =>
    import('@/components/provenance/audit-tab').catch(() => ({
      default: () => <TabPlaceholder label="Audit" />,
    })),
  { loading: () => <TabSkeleton /> },
);

const CostTabStub = dynamic(
  () => import('@/components/provenance/cost-tab-stub'),
  { loading: () => <TabSkeleton /> },
);

const DisputesTabStub = dynamic(
  () => import('@/components/provenance/disputes-tab-stub'),
  { loading: () => <TabSkeleton /> },
);

// ---------------------------------------------------------------------------
// Tab content mapping
// ---------------------------------------------------------------------------

const TAB_COMPONENTS: Record<ProvenanceTabId, React.ComponentType> = {
  'per-item': PerItemTab,
  'pipeline-health': PipelineHealthTab,
  audit: AuditTab,
  cost: CostTabStub,
  disputes: DisputesTabStub,
};

// ---------------------------------------------------------------------------
// ProvenanceContent — client component with role gate + tabs
// ---------------------------------------------------------------------------

export function ProvenanceContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { loading, canAdmin } = useUserRole();

  const tabParam = searchParams.get('tab');
  const activeTab: ProvenanceTabId = isValidTab(tabParam)
    ? tabParam
    : DEFAULT_TAB;

  // Redirect to default tab when param is missing or invalid
  useEffect(() => {
    if (!isValidTab(tabParam)) {
      router.replace(`/provenance?tab=${DEFAULT_TAB}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-16 sm:px-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAdmin) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <AccessDenied />
      </div>
    );
  }

  function handleTabChange(value: string) {
    if (isValidTab(value)) {
      router.replace(`/provenance?tab=${value}`, { scroll: false });
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <FileSearch
          className="size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-xl font-semibold">Provenance</h1>
          <p className="text-sm text-muted-foreground">
            Track data lineage, pipeline health, and audit history
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-6 w-full overflow-x-auto">
          {PROVENANCE_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {PROVENANCE_TABS.map((tab) => {
          const TabComponent = TAB_COMPONENTS[tab.id];
          return (
            <TabsContent key={tab.id} value={tab.id}>
              <Suspense fallback={<TabSkeleton />}>
                <TabComponent />
              </Suspense>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
