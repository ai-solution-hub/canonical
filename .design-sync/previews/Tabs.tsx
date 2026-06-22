import { Tabs, TabsList, TabsTrigger, TabsContent } from 'canonical';

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
