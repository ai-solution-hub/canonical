import { Separator } from 'canonical';

const wrap: React.CSSProperties = { width: 320, fontSize: 14 };
const muted: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 13,
};

export function Horizontal() {
  return (
    <div style={wrap}>
      <div style={{ fontWeight: 600 }}>Source document</div>
      <div style={muted}>ISO 27001 certificate</div>
      <Separator style={{ margin: '12px 0' }} />
      <div style={muted}>Verified · expires in 8 months</div>
    </div>
  );
}

export function Vertical() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 24 }}>
      <span>Browse</span>
      <Separator orientation="vertical" />
      <span>Review</span>
      <Separator orientation="vertical" />
      <span>Settings</span>
    </div>
  );
}
