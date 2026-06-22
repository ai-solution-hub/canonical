import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from 'canonical';

// CardHeader is a layout slot — shown in its natural Card context.
export function InCard() {
  return (
    <Card style={{ width: 360 }}>
      <CardHeader>
        <CardTitle>Coverage summary</CardTitle>
        <CardDescription>Across 6 requirement domains</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>
          The header groups the title and description with consistent spacing.
        </p>
      </CardContent>
    </Card>
  );
}
