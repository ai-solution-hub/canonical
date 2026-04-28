# Accessibility

**Purpose:** Enforce WCAG 2.1 AA accessibility standards in the Knowledge Hub
UI. As a multi-user system intended for client use, accessibility is a firm
requirement, not a nice-to-have.

**Severity:** warning (rules 1, 2, 5, 6, 7) / error (rules 3, 4)

## Rules

1. **All interactive elements must have accessible names.** [warning] Buttons,
   links, and interactive controls must have one of:
   - Visible text content
   - An `aria-label` attribute
   - An `aria-labelledby` reference New interactive elements must follow suit.

2. **All `<Image>` components must have `alt` text.** [warning] Every `<Image>`
   from `next/image` must have a non-empty `alt` prop describing the image
   content. Purely decorative images should use `alt=""` with
   `role="presentation"`.

3. **Custom click handlers on non-button elements need `role="button"` and
   keyboard support.** [error] If a `<div>`, `<span>`, or other non-interactive
   element has an `onClick` handler, it must also have:
   - `role="button"`
   - `tabIndex={0}`
   - An `onKeyDown` handler that triggers on Enter and Space keys Prefer using
     `<button>` instead of adding these attributes to a div.

4. **Fallback/placeholder images must have `role="img"` and `aria-label`.**
   [error] When rendering a placeholder instead of a real image, the container
   must have `role="img"` and an `aria-label` describing what it represents.

5. **Decorative separators must use `aria-hidden="true"`.** [warning] Visual
   separator characters (middots, bullets, pipes) between metadata items should
   have `aria-hidden="true"` so screen readers skip them.

6. **Focus indicators must be visible.** [warning] All interactive elements must
   have visible focus styles. The project uses Tailwind's
   `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
   pattern. Do not use `outline-none` without a replacement ring/border.

7. **Never use colour alone for meaning.** [warning] WCAG 2.1 AA requires that
   information conveyed by colour must also be available through other means
   (text labels, icons, patterns). For example, status indicators should include
   text labels alongside coloured badges.

8. **Toggle buttons must use `aria-pressed`.** [warning] Buttons that toggle
   state (star, bookmark, filter) should include `aria-pressed={boolean}` to
   communicate the current state.

## Examples

### Violation

```tsx
// Bad: Button without accessible name
<button onClick={handleClose}>
  <X className="size-4" />
</button>

// Bad: Clickable div without button role or keyboard support
<div onClick={handleSelect} className="cursor-pointer">
  Select this item
</div>

// Bad: Colour alone conveys meaning
<span className="bg-red-500 rounded-full size-2" />  // No text label

// Bad: focus-visible removed without replacement
<button className="outline-none" onClick={handleClick}>Click</button>
```

### Correct

```tsx
// Good: Button with aria-label for icon-only button
<button onClick={handleClose} aria-label="Close panel">
  <X className="size-4" />
</button>

// Good: Using a real button element
<button onClick={handleSelect} className="cursor-pointer">
  Select this item
</button>

// Good: Colour plus text label
<span className="flex items-center gap-1.5">
  <span className="bg-red-500 rounded-full size-2" aria-hidden="true" />
  <span>Expired</span>
</span>

// Good: Visible focus indicator
<button
  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  onClick={handleClick}
>
  Click
</button>

// Good: Decorative separator hidden from screen readers
<span aria-hidden="true">&middot;</span>
```
