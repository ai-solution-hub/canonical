# Package Manager

**Purpose:** Enforce exclusive use of bun as the package manager. The Knowledge Hub
project uses bun for all Node.js operations. npm and yarn must never be used directly.

**Severity:** error

## Rules

1. **Never use `npm` commands.** Do not run `npm install`, `npm run`, `npm test`, or any
   other npm command. Always use the bun equivalent:
   - `npm install` -> `bun install`
   - `npm run dev` -> `bun dev`
   - `npm run build` -> `bun build`
   - `npm test` -> `bun run test` (NOT `bun test` — that invokes bun's built-in test
     runner, not Vitest)
   - `npm run lint` -> `bun lint`
   - `npx` -> `bunx`

2. **Never use `yarn` commands.** Do not run `yarn add`, `yarn install`, or any other yarn
   command.

3. **No `package-lock.json` should exist in the repository.** The project uses `bun.lockb`
   (bun's binary lockfile). If a `package-lock.json` appears in a diff, it was likely
   created accidentally by running `npm install`. It must be removed.

4. **No `yarn.lock` should exist in the repository.** Same as above — only `bun.lockb` is
   the valid lockfile.

5. **Scripts in `package.json` should be invoked via `bun run` or short aliases.** When
   adding new scripts to `package.json`, document them with `bun run <script>` syntax, not
   `npm run <script>`.

6. **CI/CD and documentation references must use bun.** Any new documentation, comments,
   or configuration that references package management commands must use bun syntax.

## Examples

### Violation

```bash
# Bad: Using npm
npm install some-package
npm run build
npx create-next-app

# Bad: package-lock.json appearing in git
+++ b/package-lock.json
```

### Correct

```bash
# Good: Using bun
bun add some-package
bun build
bunx create-next-app

# Good: Only bun.lockb in the repo
```
