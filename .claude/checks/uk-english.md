# UK English

**Purpose:** Enforce UK English spelling and date formatting across all code, UI strings,
comments, and documentation. Liam is UK-based and the Knowledge Hub project uses British
English conventions. The client is also UK-based.

**Severity:** warning

## Rules

1. **Use UK spellings in identifiers, strings, and comments.** Common violations:
   - "color" should be "colour" (except in CSS property names like `background-color`, hex
     colour values, and third-party API fields)
   - "organize" / "organized" should be "organise" / "organised"
   - "authorize" / "authorized" should be "authorise" / "authorised"
   - "customize" / "customized" should be "customise" / "customised"
   - "recognize" / "recognized" should be "recognise" / "recognised"
   - "optimize" / "optimized" should be "optimise" / "optimised"
   - "center" should be "centre" (except in CSS `text-center`, `items-center`, etc.)
   - "behavior" should be "behaviour"
   - "favor" / "favorite" should be "favour" / "favourite"
   - "catalog" should be "catalogue"
   - "dialog" should be "dialogue" (except in HTML `<dialog>` element and component names
     referencing it)
   - "analyze" should be "analyse"
   - "license" (verb) is fine, but the noun should also be "licence" in UK English

2. **Date formatting must use DD/MM/YYYY or "d MMM yyyy" patterns.** The project uses
   `date-fns` for date formatting. New date formatting code must use UK patterns. Never
   use MM/DD/YYYY.

3. **Use "unauthorised" not "unauthorized".** The project uses `unauthorisedResponse()` in
   `lib/auth.ts`. Follow this convention.

4. **Use "summarise" not "summarize" in new code.** Apply the `-ise` spelling consistently
   across identifiers, comments, and copy.

5. **Error messages and UI copy must use UK English.** For example, "Colour" not "Color"
   in form labels, "Organisation" not "Organization" in UI text.

## Exceptions

- CSS property names (`color`, `background-color`, `text-align: center`) are standard CSS
  and are NOT violations
- Tailwind utility classes (`text-center`, `items-center`, `bg-red-500`) are NOT
  violations
- Third-party library API names and parameters are NOT violations (e.g. `color` prop on a
  shadcn component if that is the upstream prop name)
- The variable name `color` in `lib/validation/schemas.ts` (`ProjectCreateBodySchema`)
  maps to a database column and is NOT a violation
- Import paths and package names are NOT violations
- HTML element names (`<dialog>`) are NOT violations

## Examples

### Violation

```typescript
// Bad: American spelling in variable name
const favoriteItems = items.filter(i => i.starred);

// Bad: American spelling in UI string
<Label>Customize your dashboard</Label>

// Bad: American spelling in comment
// This function optimizes the search query
```

### Correct

```typescript
// Good: UK spelling in variable name
const favouriteItems = items.filter(i => i.starred);

// Good: UK spelling in UI string
<Label>Customise your dashboard</Label>

// Good: UK spelling in comment
// This function optimises the search query

// Good: CSS property name is fine as-is
<div style={{ color: 'red' }}>  // NOT a violation — this is CSS
```
