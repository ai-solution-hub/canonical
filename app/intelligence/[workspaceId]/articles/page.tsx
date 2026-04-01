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
          Article Review
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review articles that passed or were filtered by the relevance prompt.
          Flag incorrect classifications to improve accuracy.
        </p>
      </div>

      {/* Article list with tabs */}
      <ArticleList workspaceId={workspaceId} />
    </div>
  );
}
