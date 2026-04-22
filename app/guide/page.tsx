import { permanentRedirect } from 'next/navigation';

/**
 * /guide listing route consolidated into /coverage?tab=guides (P1-28).
 * The /guide/[slug] reader route is preserved.
 */
export default function GuidesPage() {
  permanentRedirect('/coverage?tab=guides');
}
