'use client';

import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Orientation of the rendered scrollbar(s). Defaults to `vertical` (the
   * original single-scrollbar behaviour) — `horizontal`/`both` render the
   * matching extra `ScrollBar`(s), extending the vendor-in v1 set's usage
   * (ID-147.6). */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Extra className applied to the inner `Viewport` element (distinct from
   * `className`, which applies to the outer `Root`). */
  viewportClassName?: string;
  /** Extra props spread onto the inner `Viewport` element — used by the
   * vendored viewers for keyboard-accessible listbox navigation
   * (`aria-activedescendant`, `role="listbox"`, `onKeyDown`, …). */
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
  /** Ref to the inner `Viewport` DOM node — used by the vendored viewers to
   * drive programmatic scroll (`scrollTo`, virtualizer measurement, …). */
  viewportRef?: React.Ref<HTMLDivElement>;
  /**
   * Purely cosmetic edge-fade affordance from the vendored source. Accepted
   * (typed) so vendored call sites still type-check, but currently a no-op —
   * install-as-is theming is the accepted v1 state (PRODUCT §B5/§J3); a
   * visual implementation is incremental follow-up, not a day-one gate.
   */
  scrollFade?: boolean;
  /** Same install-as-is-and-defer treatment as `scrollFade` — reserves
   * scrollbar gutter space to avoid layout shift; currently a no-op. */
  scrollbarGutter?: boolean;
  /** Same install-as-is-and-defer treatment as `scrollFade` — restricts the
   * scrollbar to appear only when content overflows; currently a no-op (our
   * Radix scrollbar already only shows on overflow by default). */
  scrollbarOverflowOnly?: boolean;
};

function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  viewportClassName,
  viewportProps,
  viewportRef,
  scrollFade: _scrollFade,
  scrollbarGutter: _scrollbarGutter,
  scrollbarOverflowOnly: _scrollbarOverflowOnly,
  ...props
}: ScrollAreaProps) {
  const { className: viewportPropsClassName, ...restViewportProps } =
    viewportProps ?? {};

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          'size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1',
          viewportClassName,
          viewportPropsClassName,
        )}
        {...restViewportProps}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation === 'vertical' || orientation === 'both' ? (
        <ScrollBar orientation="vertical" />
      ) : null}
      {orientation === 'horizontal' || orientation === 'both' ? (
        <ScrollBar orientation="horizontal" />
      ) : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' &&
          'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' &&
          'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
