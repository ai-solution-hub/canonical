# Architecture

**Purpose:** Enforce architectural conventions that keep the Knowledge Hub codebase maintainable, composable, and free of unnecessary complexity. These rules prevent common drift patterns in AI-generated code.

**Severity:** error (rules 1, 3, 4) / warning (rules 2, 5, 6)

## Rules

1. **No component files over 300 lines — split into sub-components.** [error] Components in `components/` should be under 300 lines. If a component grows beyond this, extract logical sections into separate files. New components must not exceed 300 lines. If modifying an existing oversized component, do not make it larger without splitting.

2. **Prefer composition over prop drilling.** [warning] If a component passes more than 4 props through to a child without using them, consider using React context, compound components, or restructuring the component tree. The project uses context for read marks (`contexts/read-marks-context.tsx`), taxonomy (`contexts/taxonomy-context.tsx`), client features (`contexts/client-features-context.tsx`), and CopilotKit page context (`contexts/copilot-page-context.tsx`).

3. **Keep `lib/` pure — no React imports.** [error] Files in `lib/` must not import from `react`, `next/image`, `next/link`, or any React-specific modules. The `lib/` directory contains pure utility functions, validation schemas, API helpers, and server-side logic. React-aware code belongs in `components/`, `hooks/`, `contexts/`, or `app/`. **Exception:** `lib/copilotkit/` may use CopilotKit-specific imports as it bridges the AI service layer to the CopilotKit runtime.

4. **No client-side state management libraries.** [error] Do not add Zustand, Redux, Jotai, Recoil, MobX, or similar state management libraries. The project uses:
   - React context (`contexts/`) for shared client state
   - URL search params for filter/browse state (via `hooks/use-browse-filters.ts`)
   - Server state via Supabase queries
   - Local `useState`/`useReducer` for component-local state

5. **Hooks must be in `hooks/` directory.** [warning] Custom React hooks (files starting with `use-`) belong in the `hooks/` directory, not scattered in `components/` or `lib/`. The project has ~33 hooks in `hooks/` covering browse filters, keyboard shortcuts, search, display names, draft streaming, bid actions, review queue, and more. See `hooks/` directory for the full list.

6. **MCP server constraints.** [warning] The MCP server lives in `lib/mcp/` (tools.ts, resources.ts, formatters.ts, auth.ts) and runs on Vercel serverless. Key constraints:
   - **Lazy imports:** All heavy dependencies must be lazy-loaded inside tool handlers (not top-level imports) to avoid cold start timeouts
   - **Fresh per request:** Each request creates a fresh `McpServer` + `WebStandardStreamableHTTPServerTransport` — no shared state between requests
   - **Auth via `lib/mcp/auth.ts`:** MCP tools use per-user Supabase clients from the OAuth token, NOT `getAuthenticatedClient()`
   - **Error responses:** Use MCP SDK content blocks (`{ type: 'text', text: ... }` with `isError: true`), not `NextResponse.json()`

7. **API routes follow the standard structure.** [warning] Every API route in `app/api/` should follow this template:
   ```typescript
   import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
   import { safeErrorMessage } from '@/lib/error';

   export async function METHOD(request: NextRequest) {
     try {
       const auth = await getAuthenticatedClient();
       if (!auth) return unauthorisedResponse();
       const { user, supabase } = auth;

       // ... route logic ...

     } catch (err) {
       return NextResponse.json(
         { error: safeErrorMessage(err, 'Failed to ...') },
         { status: 500 },
       );
     }
   }
   ```

## Examples

### Violation
```typescript
// Bad: React import in lib/
// lib/some-helper.ts
import { useState } from 'react';  // NOT allowed in lib/

// Bad: Adding Zustand
import { create } from 'zustand';
const useStore = create((set) => ({ ... }));

// Bad: Hook defined in components/
// components/useItemData.ts  — should be in hooks/
```

### Correct
```typescript
// Good: Pure utility in lib/
// lib/some-helper.ts
export function transformData(data: SomeType[]): OtherType[] { ... }

// Good: React context for shared state
// contexts/some-context.tsx
'use client';
import { createContext, useContext } from 'react';

// Good: Hook in hooks/ directory
// hooks/use-item-data.ts
export function useItemData(id: string) { ... }
```
