import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Progress,
  Badge,
  Separator,
} from 'canonical';

const muted: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 14,
  paddingTop: 8,
};

export function Default() {
  return (
    <Tabs defaultValue="overview" style={{ width: 420 }}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="sources">Sources</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <p style={muted}>
          Bid coverage, freshness, and open actions at a glance.
        </p>
      </TabsContent>
      <TabsContent value="sources">
        <p style={muted}>14 linked source documents.</p>
      </TabsContent>
      <TabsContent value="activity">
        <p style={muted}>Recent edits and review decisions.</p>
      </TabsContent>
    </Tabs>
  );
}

export function LineVariant() {
  return (
    <Tabs defaultValue="all" style={{ width: 420 }}>
      <TabsList variant="line">
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="open">Open</TabsTrigger>
        <TabsTrigger value="resolved">Resolved</TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        <p style={muted}>The line variant underlines the active tab.</p>
      </TabsContent>
    </Tabs>
  );
}

// RECIPE — Bid workspace: the tabbed detail view of a single bid. The Coverage
// tab carries a composite panel (progress + confidence posture) so the recipe
// shows real content in context, not an empty tab body.
export function BidWorkspace() {
  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
  };
  return (
    <Tabs defaultValue="coverage" style={{ width: 560 }}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="coverage">Coverage</TabsTrigger>
        <TabsTrigger value="sources">Sources</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="coverage">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            paddingTop: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--muted-foreground)' }}>
                Technical section
              </span>
              <span style={{ fontWeight: 600 }}>78%</span>
            </div>
            <Progress value={78} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--muted-foreground)' }}>
                Commercial section
              </span>
              <span style={{ fontWeight: 600 }}>52%</span>
            </div>
            <Progress value={52} />
          </div>
          <Separator />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge variant="secondary">8 strong</Badge>
            <Badge variant="outline">4 partial</Badge>
            <Badge variant="destructive">2 need SME</Badge>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="overview">
        <p style={muted}>
          Buyer, deadline, and submission status for this bid.
        </p>
      </TabsContent>
      <TabsContent value="sources">
        <p style={muted}>14 linked source documents across 5 frameworks.</p>
      </TabsContent>
      <TabsContent value="activity">
        <p style={muted}>Recent edits, AI drafts, and review decisions.</p>
      </TabsContent>
    </Tabs>
  );
}
