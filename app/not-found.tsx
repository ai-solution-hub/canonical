import Link from 'next/link';
import { SearchBar } from '@/components/browse/search-bar';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      {/* 404 indicator */}
      <div className="mb-2 text-7xl font-bold tracking-tighter text-primary/20">
        404
      </div>

      <h1 className="text-fluid-2xl font-bold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Sorry, we couldn&apos;t find the page you&apos;re looking for. Try
        searching for what you need, or navigate to one of the pages below.
      </p>

      {/* Search bar */}
      <div className="mt-8 w-full">
        <SearchBar variant="hero" autoFocus />
      </div>

      {/* Navigation links */}
      <nav className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Home
        </Link>
        <Link
          href="/browse"
          className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Browse
        </Link>
        <Link
          href="/workspaces"
          className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Workspaces
        </Link>
        <Link
          href="/digest"
          className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Digest
        </Link>
      </nav>
    </div>
  );
}
