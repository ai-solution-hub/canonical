'use client';

import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { ImageIcon, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { safeErrorMessage } from '@/lib/error';

interface GalleryImage {
  url: string;
  page: number;
  index: number;
  width: number;
  height: number;
  format?: string;
}

interface ImageGalleryProps {
  itemId: string;
  hasExtractedImages: boolean;
  className?: string;
}

export function ImageGallery({
  itemId,
  hasExtractedImages,
  className = '',
}: ImageGalleryProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [extractedAt, setExtractedAt] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  // Fetch existing images on mount if extraction has been done
  useEffect(() => {
    if (!hasExtractedImages || hasFetched) return;

    async function fetchImages() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/items/${itemId}/images`);
        if (!res.ok) return;
        const data = await res.json();
        setImages(data.images ?? []);
        setExtractedAt(data.extracted_at ?? null);
      } catch {
        // Silently fail — images are supplementary
      } finally {
        setIsLoading(false);
        setHasFetched(true);
      }
    }

    fetchImages();
  }, [itemId, hasExtractedImages, hasFetched]);

  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    try {
      const res = await fetch(`/api/items/${itemId}/images`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Image extraction failed');
        return;
      }

      if (data.images.length === 0) {
        toast.info('No extractable images found in this PDF.');
        setExtractedAt(new Date().toISOString());
        return;
      }

      // Fetch signed URLs for the newly extracted images
      const urlRes = await fetch(`/api/items/${itemId}/images`);
      if (urlRes.ok) {
        const urlData = await urlRes.json();
        setImages(urlData.images ?? []);
        setExtractedAt(urlData.extracted_at ?? null);
      }

      toast.success(
        `Extracted ${data.total_uploaded} image${data.total_uploaded === 1 ? '' : 's'} from PDF`,
      );
    } catch (err) {
      console.error('Failed to extract images:', err);
      toast.error(safeErrorMessage(err, 'Failed to extract images'));
    } finally {
      setIsExtracting(false);
    }
  }, [itemId]);

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const navigateLightbox = useCallback(
    (direction: 'prev' | 'next') => {
      if (lightboxIndex === null || images.length === 0) return;
      if (direction === 'prev') {
        setLightboxIndex(
          lightboxIndex > 0 ? lightboxIndex - 1 : images.length - 1,
        );
      } else {
        setLightboxIndex(
          lightboxIndex < images.length - 1 ? lightboxIndex + 1 : 0,
        );
      }
    },
    [lightboxIndex, images.length],
  );

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateLightbox('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateLightbox('next');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, navigateLightbox]);

  const currentImage = lightboxIndex !== null ? images[lightboxIndex] : null;

  return (
    <section className={className} aria-label="PDF images">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Extracted Images
          {images.length > 0 && (
            <span className="ml-1.5 text-muted-foreground font-normal">
              ({images.length})
            </span>
          )}
        </h2>
        <Button
          variant={images.length > 0 ? 'outline' : 'default'}
          size="sm"
          onClick={handleExtract}
          disabled={isExtracting}
          className="gap-1.5"
        >
          {isExtracting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImageIcon className="size-3.5" />
          )}
          {isExtracting
            ? 'Extracting...'
            : images.length > 0
              ? 'Re-extract'
              : 'Extract Images'}
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading images...
        </div>
      )}

      {/* Extracting state */}
      {isExtracting && (
        <div
          className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" />
          Extracting images from PDF... This may take a moment.
        </div>
      )}

      {/* Empty state after extraction */}
      {!isLoading && !isExtracting && images.length === 0 && extractedAt && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>No extractable images found in this PDF.</span>
        </div>
      )}

      {/* Image grid */}
      {images.length > 0 && (
        <>
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
            role="list"
            aria-label="Extracted PDF images"
          >
            {images.map((img, idx) => (
              <button
                key={`${img.page}-${img.index}`}
                onClick={() => openLightbox(idx)}
                className="group relative aspect-square overflow-hidden rounded-lg border bg-muted/30 transition-all hover:border-primary/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                role="listitem"
                aria-label={`Image from page ${img.page}, ${img.width} by ${img.height} pixels. Click to enlarge.`}
              >
                <Image
                  src={img.url}
                  alt={`Extracted from page ${img.page}`}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                  className="object-contain transition-transform group-hover:scale-105"
                  unoptimized
                />
                <Badge
                  variant="secondary"
                  className="absolute bottom-1.5 left-1.5 text-[10px] opacity-80"
                >
                  Page {img.page}
                </Badge>
              </button>
            ))}
          </div>

          {extractedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Extracted{' '}
              {new Date(extractedAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          )}
        </>
      )}

      {/* Lightbox dialog */}
      <Dialog
        open={lightboxIndex !== null}
        onOpenChange={(open) => {
          if (!open) closeLightbox();
        }}
      >
        <DialogContent
          className="max-h-[90vh] max-w-[90vw] p-0 sm:max-w-4xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {currentImage
              ? `Image from page ${currentImage.page} — ${currentImage.width} x ${currentImage.height}`
              : 'Image preview'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Full-size preview of the extracted PDF image. Use arrow keys or
            buttons to navigate between images.
          </DialogDescription>

          {currentImage && (
            <div className="relative flex items-center justify-center bg-black/5 dark:bg-white/5">
              {/* Close button */}
              <button
                onClick={closeLightbox}
                className="absolute top-3 right-3 z-10 rounded-full bg-background/80 p-1.5 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label="Close preview"
              >
                <X className="size-4" />
              </button>

              {/* Navigation — Previous */}
              {images.length > 1 && (
                <button
                  onClick={() => navigateLightbox('prev')}
                  className="absolute left-3 z-10 rounded-full bg-background/80 p-1.5 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="size-5" />
                </button>
              )}

              {/* Image */}
              <div className="relative flex max-h-[80vh] w-full items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImage.url}
                  alt={`Extracted from page ${currentImage.page}`}
                  className="max-h-[75vh] max-w-full rounded object-contain"
                  style={{
                    maxWidth: Math.min(currentImage.width, 1200),
                  }}
                />
              </div>

              {/* Navigation — Next */}
              {images.length > 1 && (
                <button
                  onClick={() => navigateLightbox('next')}
                  className="absolute right-3 z-10 rounded-full bg-background/80 p-1.5 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label="Next image"
                >
                  <ChevronRight className="size-5" />
                </button>
              )}

              {/* Image info bar */}
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-background/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur-sm">
                <span>
                  Page {currentImage.page} &middot; {currentImage.width} &times;{' '}
                  {currentImage.height} px
                </span>
                {images.length > 1 && (
                  <span>
                    {(lightboxIndex ?? 0) + 1} of {images.length}
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
