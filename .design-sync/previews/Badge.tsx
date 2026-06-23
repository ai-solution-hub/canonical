import { Badge } from 'canonical';
import { Check, AlertTriangle, Clock } from 'lucide-react';

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
};

export function Variants() {
  return (
    <div style={row}>
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="link">Link</Badge>
    </div>
  );
}

export function StatusLabels() {
  return (
    <div style={row}>
      <Badge>
        <Check /> Verified
      </Badge>
      <Badge variant="secondary">
        <Clock /> Pending review
      </Badge>
      <Badge variant="destructive">
        <AlertTriangle /> Stale
      </Badge>
      <Badge variant="outline">Draft</Badge>
    </div>
  );
}

export function Counts() {
  return (
    <div style={row}>
      <Badge>3 new</Badge>
      <Badge variant="secondary">128</Badge>
      <Badge variant="outline">v2.1</Badge>
    </div>
  );
}
