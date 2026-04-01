'use client';

interface IframeViewerProps {
  src: string;
  title?: string;
  height?: string;
}

/** Placeholder — iframe viewer not yet implemented in Knowledge Hub. */
export function IframeViewer({ src, title = 'External content', height = '600px' }: IframeViewerProps) {
  return (
    <div className="overflow-hidden rounded-lg border" style={{ height }}>
      <iframe
        src={src}
        title={title}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
