import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from 'canonical';

const muted: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 13,
};

// Rendered open (defaultOpen) so the card captures the modal content, not the
// trigger. A destructive confirm is the most representative knowledge-base flow.
export function Open() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="outline">Deactivate source</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate source?</DialogTitle>
          <DialogDescription>
            “FY24 Procurement Framework” will stop contributing to bid coverage
            and answer provenance. Linked answers stay, but flag as unsourced.
          </DialogDescription>
        </DialogHeader>
        <div style={muted}>
          You can reactivate this source at any time from the library.
        </div>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Deactivate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
