import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  Button,
} from 'canonical';

const muted: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 13,
};

export function Default() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Source details</Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>ISO 27001 certificate</PopoverTitle>
          <PopoverDescription>
            Verified against the issuing body 3 weeks ago.
          </PopoverDescription>
        </PopoverHeader>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginTop: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={muted}>Coverage</span>
            <span style={{ fontSize: 13 }}>4 questions</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={muted}>Expires</span>
            <span style={{ fontSize: 13 }}>8 months</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
