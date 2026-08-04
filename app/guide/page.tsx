import type { Metadata } from 'next';
import { BRANDING } from '@/lib/client-config';
import { GuideListContent } from './guide-list-content';

export const metadata: Metadata = {
  title: `Guides — ${BRANDING.productShortName}`,
  description: 'Browse the knowledge base guides.',
};

/**
 * /guide listing (DR-126 first-class surface). Rebuilt S531 — see
 * GuideListContent for the lineage of the retired /coverage redirect.
 */
export default function GuidesPage() {
  return (
    <section
      aria-label="Guides"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6"
    >
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Guides</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Curated entry points into the knowledge base
        </p>
      </div>
      <GuideListContent />
    </section>
  );
}
