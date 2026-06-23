import { SheetHeader } from 'canonical';

const panel: React.CSSProperties = {
  width: 380,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--card)',
};

// SheetHeader is a layout slot from the Sheet (side panel). Shown inside a
// panel mock so its spacing reads without opening an overlay.
export function Header() {
  return (
    <div style={panel}>
      <SheetHeader>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Filter sources</h2>
        <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
          Narrow the library by domain, freshness, and owner.
        </p>
      </SheetHeader>
    </div>
  );
}
