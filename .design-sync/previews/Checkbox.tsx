import { Checkbox, Label } from 'canonical';

const field: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const col: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

export function States() {
  return (
    <div style={col}>
      <div style={field}>
        <Checkbox id="c1" defaultChecked />
        <Label htmlFor="c1">Include archived sources</Label>
      </div>
      <div style={field}>
        <Checkbox id="c2" />
        <Label htmlFor="c2">Notify on coverage gaps</Label>
      </div>
      <div style={field}>
        <Checkbox id="c3" defaultChecked disabled />
        <Label htmlFor="c3">Audit logging (locked)</Label>
      </div>
    </div>
  );
}
