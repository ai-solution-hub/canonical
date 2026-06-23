import { ConceptHelp, TooltipProvider } from 'canonical';

const panel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 20,
  maxWidth: 320,
};
const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const label: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 14,
  color: 'var(--foreground)',
};
const value: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--muted-foreground)',
};

// ConceptHelp is the small `?` affordance placed beside a concept's primary
// label; hover or keyboard focus reveals a one-sentence, plain-language
// explanation (closed by default, so the static card shows the affordance in
// its real home — next to knowledge-base metric labels). Each `concept` key is
// a reviewed entry from the platform vocabulary. Relies on the global
// TooltipProvider mounted once near the app root.
export function InContext() {
  return (
    <TooltipProvider>
      <div style={panel}>
        <div style={row}>
          <span style={label}>
            Coverage <ConceptHelp concept="coverage" />
          </span>
          <span style={value}>82%</span>
        </div>
        <div style={row}>
          <span style={label}>
            Priority gaps <ConceptHelp concept="priority-gaps" />
          </span>
          <span style={value}>4</span>
        </div>
        <div style={row}>
          <span style={label}>
            Governance review <ConceptHelp concept="governance-review" />
          </span>
          <span style={value}>Due</span>
        </div>
        <div style={row}>
          <span style={label}>
            Freshness <ConceptHelp concept="freshness" />
          </span>
          <span style={value}>2d ago</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
