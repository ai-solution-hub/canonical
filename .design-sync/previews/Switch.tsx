import { Switch, Label } from 'canonical';

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};
const col: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

export function States() {
  return (
    <div style={col}>
      <div style={row}>
        <Switch id="s1" defaultChecked />
        <Label htmlFor="s1">Email digests</Label>
      </div>
      <div style={row}>
        <Switch id="s2" />
        <Label htmlFor="s2">Auto-reingest on change</Label>
      </div>
      <div style={row}>
        <Switch id="s3" defaultChecked disabled />
        <Label htmlFor="s3">Audit logging (locked)</Label>
      </div>
    </div>
  );
}
