import { Label, Input } from 'canonical';

const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: 320,
};

export function WithField() {
  return (
    <div style={field}>
      <Label htmlFor="org">Organisation name</Label>
      <Input id="org" placeholder="Acme Ltd" />
    </div>
  );
}
