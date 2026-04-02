'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import {
  MessageSquare,
  FileText,
  File,
  Package,
  Headphones,
  Play,
  MessageCircle,
  Mail,
  Bookmark,
  FileAudio,
  StickyNote,
  GraduationCap,
  FlaskConical,
  Globe,
  CircleHelp,
  FileCheck,
  Shield,
  Award,
  ClipboardCheck,
  Workflow,
  Star,
  ShoppingBag,
} from 'lucide-react';
import { useTaxonomy } from '@/contexts/taxonomy-context';

const ICON_MAP: Record<string, React.ElementType> = {
  post: MessageSquare,
  article: FileText,
  blog: FileText,
  pdf: File,
  'product-page': Package,
  podcast: Headphones,
  video: Play,
  comment: MessageCircle,
  newsletter: Mail,
  email: Mail,
  bookmark: Bookmark,
  transcript: FileAudio,
  note: StickyNote,
  course: GraduationCap,
  research: FlaskConical,
  other: Globe,
  // Knowledge Hub content types
  q_a_pair: CircleHelp,
  case_study: FileCheck,
  policy: Shield,
  certification: Award,
  compliance: ClipboardCheck,
  methodology: Workflow,
  capability: Star,
  product_description: ShoppingBag,
};

const SUPABASE_STORAGE_HOST = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', '')}/storage`;

/**
 * For small fixed-size thumbnails (list rows), use Supabase render transforms
 * to avoid downloading full-size images. For the main Thumbnail component,
 * we let next/image handle sizing — it knows about device pixel ratio and
 * generates responsive srcset for sharp rendering on Retina displays.
 */
function getSmallOptimisedSrc(src: string, size: number): string {
  if (!src.includes(SUPABASE_STORAGE_HOST)) return src;
  const renderUrl = src.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  );
  const separator = renderUrl.includes('?') ? '&' : '?';
  return `${renderUrl}${separator}width=${size * 2}&height=${size * 2}&resize=cover`;
}

/** Generate a deterministic gradient angle from a string. */
function hashToAngle(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** Default sizes hint for the browse grid (1-4 columns within max-w-7xl). */
const GRID_SIZES =
  '(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) calc(50vw - 3rem), (max-width: 1280px) calc(33vw - 3rem), calc(25vw - 3rem)';

interface ThumbnailProps {
  src: string | null;
  alt: string;
  contentType?: string | null;
  domain?: string | null;
  aspectRatio?: 'video' | 'square';
  /** Aspect ratio for fallback placeholders (shorter to reduce visual weight). Defaults to same as aspectRatio. */
  placeholderAspect?: 'compact' | 'video' | 'square';
  className?: string;
  /** Override the default sizes hint (e.g. for detail pages that render wider). */
  sizes?: string;
}

export function Thumbnail({
  src,
  alt,
  contentType,
  domain,
  aspectRatio = 'video',
  placeholderAspect,
  className = '',
  sizes = GRID_SIZES,
}: ThumbnailProps) {
  const { getDomainColourKey } = useTaxonomy();
  const [hasError, setHasError] = useState(false);
  const showFallback = !src || hasError;
  const colourKey = domain ? getDomainColourKey(domain) : 'meta';
  const Icon = ICON_MAP[contentType ?? 'other'] ?? Globe;

  const aspectClass =
    aspectRatio === 'video' ? 'aspect-video' : 'aspect-square';

  const fallbackAspectClass =
    placeholderAspect === 'compact'
      ? 'aspect-[16/7]'
      : placeholderAspect === 'square'
        ? 'aspect-square'
        : aspectClass;

  // Deterministic gradient for visually richer placeholders
  const gradientAngle = useMemo(() => hashToAngle(alt || 'untitled'), [alt]);

  if (showFallback) {
    return (
      <div
        className={`${fallbackAspectClass} flex flex-col items-center justify-center gap-2 rounded-lg ${className}`}
        style={{
          background: `linear-gradient(${gradientAngle}deg, var(--domain-${colourKey}-surface), var(--domain-${colourKey}-surface) 60%, color-mix(in oklch, var(--domain-${colourKey}-text) 8%, var(--domain-${colourKey}-surface)))`,
        }}
        role="img"
        aria-label={alt}
      >
        <Icon
          className="size-8 opacity-30"
          style={{ color: `var(--domain-${colourKey}-text)` }}
        />
        {alt && alt.length > 0 && alt !== 'Untitled' && (
          <span
            className="max-w-[80%] truncate text-center text-[10px] font-medium leading-tight opacity-40"
            style={{ color: `var(--domain-${colourKey}-text)` }}
          >
            {alt}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${aspectClass} relative overflow-hidden rounded-lg ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        quality={85}
        sizes={sizes}
        onError={() => setHasError(true)}
        className="object-cover"
      />
    </div>
  );
}

/** Small thumbnail for list rows (48x48) */
export function ThumbnailSmall({
  src,
  alt,
  contentType,
  domain,
}: Omit<ThumbnailProps, 'aspectRatio' | 'className'>) {
  const { getDomainColourKey } = useTaxonomy();
  const [hasError, setHasError] = useState(false);
  const showFallback = !src || hasError;
  const colourKey = domain ? getDomainColourKey(domain) : 'meta';
  const Icon = ICON_MAP[contentType ?? 'other'] ?? Globe;

  if (showFallback) {
    return (
      <div
        className="flex size-12 shrink-0 items-center justify-center rounded-md"
        style={{ background: `var(--domain-${colourKey}-surface)` }}
        role="img"
        aria-label={alt}
      >
        <Icon
          className="size-5 opacity-40"
          style={{ color: `var(--domain-${colourKey}-text)` }}
        />
      </div>
    );
  }

  // Small thumbnails use Supabase render transforms (96px is enough at 2x for 48px display)
  const optimised = getSmallOptimisedSrc(src, 48);

  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded-md">
      <Image
        src={optimised}
        alt={alt}
        fill
        sizes="48px"
        onError={() => setHasError(true)}
        className="object-cover"
      />
    </div>
  );
}
