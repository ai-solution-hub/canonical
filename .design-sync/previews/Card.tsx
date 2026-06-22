import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
  Button,
  Badge,
} from 'canonical';

export function Default() {
  return (
    <Card style={{ width: 360 }}>
      <CardHeader>
        <CardTitle>Procurement bid — Highways framework</CardTitle>
        <CardDescription>
          Last updated 2 days ago · 14 questions answered
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>
          Coverage is strong across technical and commercial sections. Three
          questions still need supporting evidence before submission.
        </p>
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button>Continue</Button>
        <Button variant="outline">Export</Button>
      </CardFooter>
    </Card>
  );
}

export function WithAction() {
  return (
    <Card style={{ width: 360 }}>
      <CardHeader>
        <CardTitle>Source document</CardTitle>
        <CardDescription>ISO 27001 certificate</CardDescription>
        <CardAction>
          <Badge variant="secondary">PDF</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>
          Verified against the issuing body. Expires in 8 months.
        </p>
      </CardContent>
    </Card>
  );
}
