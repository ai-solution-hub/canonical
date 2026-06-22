import { Input } from 'canonical';

const col: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: 320,
};

export function States() {
  return (
    <div style={col}>
      <Input placeholder="Search the knowledge base…" />
      <Input type="email" defaultValue="team@canonical.example" />
      <Input placeholder="Disabled field" disabled />
      <Input aria-invalid="true" defaultValue="Invalid value" />
    </div>
  );
}
