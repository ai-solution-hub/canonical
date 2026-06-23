import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  Button,
} from 'canonical';

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 14,
};

const muted: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 13,
};

// Rendered open (defaultOpen) so the card captures the side panel, not the
// trigger. A source-library filter panel is the representative use.
export function Open() {
  return (
    <Sheet defaultOpen>
      <SheetTrigger asChild>
        <Button variant="outline">Filters</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Filter sources</SheetTitle>
          <SheetDescription>
            Narrow the library by domain, freshness, and owner.
          </SheetDescription>
        </SheetHeader>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: '0 16px',
          }}
        >
          <div style={row}>
            <span>Domain</span>
            <span style={muted}>Procurement</span>
          </div>
          <div style={row}>
            <span>Freshness</span>
            <span style={muted}>Last 90 days</span>
          </div>
          <div style={row}>
            <span>Owner</span>
            <span style={muted}>Bid team</span>
          </div>
          <div style={row}>
            <span>Coverage status</span>
            <span style={muted}>Verified only</span>
          </div>
        </div>
        <SheetFooter>
          <Button>Apply filters</Button>
          <Button variant="outline">Reset</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
