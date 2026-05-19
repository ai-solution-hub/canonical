# Image Quality

**Purpose:** Enforce image quality standards across the Knowledge Hub UI. The project uses
`next/image` with specific quality and sizing conventions to ensure sharp rendering on
Retina displays and optimal file sizes.

**Severity:** error

## Rules

1. **All `<Image>` components from `next/image` must have `quality={85}`.** The project
   standard is `quality={85}` (set as a prop, not in `next.config.ts`). The Next.js
   default of 75 is too aggressive for content thumbnails. Any new `<Image>` usage must
   include `quality={85}`.

2. **All `<Image>` components using `fill` must have an accurate `sizes` prop.** The
   `sizes` prop tells the browser how wide the image will be at different viewport widths,
   enabling next/image to generate the right srcset. Without it, next/image defaults to
   the full viewport width, downloading images far larger than needed.
   - For fixed-size thumbnails (e.g. list rows at 48px): use `sizes="48px"`
   - For detail pages: use a `sizes` value matching the actual layout width

3. **Never use `unoptimized` on `<Image>` components.** The `unoptimized` prop disables
   next/image's automatic format conversion (AVIF/WebP), srcset generation, and quality
   control.

4. **Never pre-downsize images before passing to `<Image>`.** Do not transform or resize
   image URLs before passing them as `src` to next/image. The component needs the
   full-size source to generate DPR-aware srcset for Retina displays.

5. **All `<Image>` components must have meaningful `alt` text.** Empty `alt=""` is only
   acceptable for decorative images. Content thumbnails should use the item title as alt
   text.

6. **New remote image domains must be added to `remotePatterns` in `next.config.ts`.** If
   a new external image source is introduced, add its hostname to the
   `images.remotePatterns` array.

## Examples

### Violation

```tsx
// Bad: Missing quality prop
<Image src={url} alt={title} fill sizes="100vw" />

// Bad: Missing sizes prop with fill
<Image src={url} alt={title} fill quality={85} />

// Bad: Using unoptimized
<Image src={url} alt={title} fill quality={85} sizes="100vw" unoptimized />

// Bad: Sizes prop says "100vw" when image is in a constrained container
<Image src={url} alt={title} fill quality={85} sizes="100vw" />
```

### Correct

```tsx
// Good: Full specification for grid thumbnail
<Image
  src={url}
  alt={title}
  fill
  quality={85}
  sizes="(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) calc(50vw - 3rem), calc(25vw - 3rem)"
  className="object-cover"
/>

// Good: Fixed-size thumbnail in list
<Image src={url} alt={title} fill sizes="48px" />

// Good: Using width/height instead of fill (quality still required)
<Image src={url} alt={title} width={200} height={112} quality={85} />
```
