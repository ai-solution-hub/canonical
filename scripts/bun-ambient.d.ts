// Minimal Bun ambient declarations for the standalone `scripts/*.ts` CLIs
// (bl-213). These scripts run under the Bun runtime (`bun run scripts/...`)
// and use a tiny slice of the Bun API plus `import.meta.dir`.
//
// We deliberately do NOT depend on the full `@types/bun` (bun-types) package
// here: bun-types re-declares DOM globals (notably a Bun-shaped `fetch`) that
// are incompatible with the repo's DOM `lib` + `@types/node`, and pulling them
// in — globally OR via a file-local `/// <reference types="bun" />` — leaks
// those overrides program-wide and breaks ~120 unrelated app/test files. This
// file declares only the exact surface the CLIs touch, so the CI build-gate
// (`tsconfig.ci.json`) can typecheck `scripts/` without that collateral.

interface BunFile {
  /** Synchronously read the file's contents as a UTF-8 string. */
  textSync(): string;
}

interface BunNamespace {
  /** Reference a file on disk (lazy; no I/O until read). */
  file(path: string): BunFile;
  /** Standard input as a Bun file/stream. */
  stdin: {
    /** Async-iterable stream of byte chunks from stdin. */
    stream(): AsyncIterable<Uint8Array>;
  };
}

declare const Bun: BunNamespace;

interface ImportMeta {
  /** Absolute path to the directory containing the current module (Bun). */
  readonly dir: string;
}
