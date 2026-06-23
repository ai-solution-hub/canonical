import { SheetFooter, Button } from 'canonical';

const panel: React.CSSProperties = {
  width: 380,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--card)',
};

// SheetFooter is a layout slot from the Sheet (side panel) — typically the
// action row pinned to the bottom. Shown inside a panel mock.
export function Footer() {
  return (
    <div style={panel}>
      <SheetFooter>
        <Button>Apply filters</Button>
        <Button variant="outline">Reset</Button>
      </SheetFooter>
    </div>
  );
}
