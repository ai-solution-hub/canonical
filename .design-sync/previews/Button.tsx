import { Button } from 'canonical';
import { Plus, Trash2, ArrowRight, Search } from 'lucide-react';

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'center',
};

export function Variants() {
  return (
    <div style={row}>
      <Button>Run bid session</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="destructive">Delete source</Button>
      <Button variant="ghost">Dismiss</Button>
      <Button variant="link">View provenance</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Search">
        <Search />
      </Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={row}>
      <Button>
        <Plus /> New item
      </Button>
      <Button variant="destructive">
        <Trash2 /> Remove
      </Button>
      <Button variant="outline">
        Continue <ArrowRight />
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={row}>
      <Button disabled>Submitting…</Button>
      <Button variant="secondary" disabled>
        Unavailable
      </Button>
    </div>
  );
}
