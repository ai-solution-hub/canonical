import { Progress } from 'canonical';

const col: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  width: 320,
};
const labelRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 13,
  color: 'var(--muted-foreground)',
  marginBottom: 6,
};

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={labelRow}>
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <Progress value={value} />
    </div>
  );
}

export function CoverageLevels() {
  return (
    <div style={col}>
      <Bar label="Technical section" value={82} />
      <Bar label="Commercial section" value={45} />
      <Bar label="Compliance section" value={100} />
    </div>
  );
}
