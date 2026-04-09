'use client';

import { useParams } from 'next/navigation';
import { ArticleList } from '@/components/intelligence/article-list';

export default function ArticlesPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">
          Articles
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review articles from your sources. The relevant ones land in Passed,
          the rest in Filtered. Tell us when something is in the wrong pile.
        </p>
      </div>

      {/* Article list with tabs */}
      <ArticleList workspaceId={workspaceId} />
    </div>
  );
}
