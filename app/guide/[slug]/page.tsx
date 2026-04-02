import type { Metadata } from 'next';
import { GuideContent } from './guide-content';

interface GuidePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  // Format slug into a readable title for the metadata
  const title = slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return {
    title: `${title} — Guides — Knowledge Hub`,
    description: `Guide: ${title}`,
  };
}

export default async function GuidePage({ params }: GuidePageProps) {
  const { slug } = await params;
  return <GuideContent slug={slug} />;
}
