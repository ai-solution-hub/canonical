// Renamed kh-prod-readiness-S11b: split into `@/lib/env-server` (server-only
// secrets parsed at boot) and `@/lib/env-client` (NEXT_PUBLIC_* parsed at
// boot). This shim guards stale branches and cherry-picks: importing the old
// path now throws at module load with a pointer to the correct module.
throw new Error(
  '@/lib/env was renamed in kh-prod-readiness-S11b. Import from @/lib/env-server (server) or @/lib/env-client (client).',
);
