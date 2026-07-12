import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * ID-145 {145.18} BI-2/BI-3 — the standard not-found surface for
 * `/procurement/[id]`. Rendered when `notFound()` fires on a confirmed 404
 * (an unknown or retired form id). NO legacy redirect: R3's wholesale
 * workspace delete leaves nothing to map an old id onto, so this is the
 * entire not-found treatment — no primary-form lookup, no
 * workspace->form mapping snapshot.
 */
export default function ProcurementDetailNotFound() {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center"
    >
      <Briefcase
        className="mb-4 size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Procurement not found
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        This procurement item doesn&apos;t exist, or may have been deleted.
      </p>
      <Button asChild variant="outline">
        <Link href="/procurement">Back to Procurement</Link>
      </Button>
    </div>
  );
}
