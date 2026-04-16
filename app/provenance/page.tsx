import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { ProvenanceContent } from './provenance-content';

function ProvenancePageSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-16 sm:px-6">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function ProvenancePage() {
  return (
    <Suspense fallback={<ProvenancePageSkeleton />}>
      <ProvenanceContent />
    </Suspense>
  );
}
