import { Textarea, Label } from 'canonical';

const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: 360,
};

export function WithLabel() {
  return (
    <div style={field}>
      <Label htmlFor="notes">Answer notes</Label>
      <Textarea
        id="notes"
        rows={4}
        defaultValue="Coverage is strong across technical sections; commercial pricing still needs sign-off from the bid lead before submission."
      />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={field}>
      <Textarea placeholder="Add context for the reviewer…" rows={3} />
    </div>
  );
}
