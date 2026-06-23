import { RadioGroup, RadioGroupItem, Label } from 'canonical';

const item: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

export function Options() {
  return (
    <RadioGroup
      defaultValue="balanced"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div style={item}>
        <RadioGroupItem value="strict" id="r-strict" />
        <Label htmlFor="r-strict">Strict — flag every change</Label>
      </div>
      <div style={item}>
        <RadioGroupItem value="balanced" id="r-balanced" />
        <Label htmlFor="r-balanced">Balanced — high-stakes columns only</Label>
      </div>
      <div style={item}>
        <RadioGroupItem value="lenient" id="r-lenient" />
        <Label htmlFor="r-lenient">Lenient — manual review</Label>
      </div>
    </RadioGroup>
  );
}
