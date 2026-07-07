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
  Progress,
  Separator,
} from 'canonical';
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Rss,
  Clock,
  ExternalLink,
  Pencil,
  Trash2,
  Download,
  RefreshCw,
  Building2,
  CalendarClock,
} from 'lucide-react';

const muted: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 14,
};

// Domain status pill — mirrors the app's bid / governance / priority chips,
// coloured from the same semantic tokens. `-border` falls back to transparent
// for the token families that don't define one (priority-tier, template).
function Pill({
  token,
  children,
}: {
  token: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.6,
        color: `var(--${token})`,
        background: `var(--${token}-bg)`,
        border: `1px solid var(--${token}-border, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        display: 'inline-block',
        flex: '0 0 auto',
      }}
    />
  );
}

function StatTile({
  icon,
  label,
  value,
  suffix,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  color: string;
  bg: string;
}) {
  return (
    <Card style={{ minWidth: 0 }}>
      <CardContent style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            display: 'inline-flex',
            width: 40,
            height: 40,
            flex: '0 0 auto',
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            color,
            background: bg,
          }}
        >
          {icon}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            {label}
          </span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.1,
            }}
          >
            {value}
            {suffix ? (
              <span style={{ fontSize: 15, color: 'var(--muted-foreground)' }}>
                {suffix}
              </span>
            ) : null}
          </span>
        </span>
      </CardContent>
    </Card>
  );
}

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
        <p style={muted}>
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
        <p style={muted}>
          Verified against the issuing body. Expires in 8 months.
        </p>
      </CardContent>
    </Card>
  );
}

// RECIPE — Bid coverage summary: the procurement list card. Workflow-status
// chip, buyer + deadline metadata, question-drafting progress, and the
// strong/partial/needs-SME/no-content confidence posture row.
export function BidCoverageSummary() {
  return (
    <Card style={{ width: 460 }}>
      <CardHeader>
        <CardTitle>Highways maintenance framework — Lot 2</CardTitle>
        <CardDescription
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Building2 size={14} /> National Highways
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              color: 'var(--form-overdue)',
            }}
          >
            <CalendarClock size={14} /> Due in 6 days
          </span>
        </CardDescription>
        <CardAction>
          <Pill token="bid-in-review">In review</Pill>
        </CardAction>
      </CardHeader>
      <CardContent
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
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
              14 of 22 questions drafted
            </span>
            <span
              style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
            >
              64%
            </span>
          </div>
          <Progress value={64} />
        </div>
        <div
          style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}
        >
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Dot color="var(--success)" /> Strong 8
          </span>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Dot color="var(--form-active)" /> Partial 4
          </span>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Dot color="var(--freshness-aging)" /> Needs SME 2
          </span>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Dot color="var(--muted-foreground)" /> No content 8
          </span>
        </div>
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button>
          Continue drafting <ArrowRight />
        </Button>
        <Button variant="outline">Export</Button>
      </CardFooter>
    </Card>
  );
}

// RECIPE — Coverage summary stat cards: the 4-up dashboard grid. Total items,
// weighted freshness %, content gaps, expired items — each a Card + icon tile.
export function CoverageStats() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        width: '100%',
      }}
    >
      <StatTile
        icon={<BarChart3 size={20} />}
        label="Total items"
        value="1,248"
        color="var(--primary)"
        bg="var(--accent)"
      />
      <StatTile
        icon={<CheckCircle2 size={20} />}
        label="Fresh"
        value="82"
        suffix="%"
        color="var(--freshness-fresh)"
        bg="var(--freshness-fresh-bg)"
      />
      <StatTile
        icon={<AlertTriangle size={20} />}
        label="Content gaps"
        value="37"
        color="var(--freshness-aging)"
        bg="var(--freshness-aging-bg)"
      />
      <StatTile
        icon={<XCircle size={20} />}
        label="Expired"
        value="9"
        color="var(--freshness-expired)"
        bg="var(--freshness-expired-bg)"
      />
    </div>
  );
}

// RECIPE — Priority gap card: a content-coverage gap. Priority tier + source
// chips, gap title and rationale, domain tags, and the close-gap action.
export function PriorityGap() {
  return (
    <Card style={{ width: 520 }}>
      <CardContent
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Pill token="priority-tier-critical">
              <AlertTriangle size={12} /> Critical
            </Pill>
            <Badge variant="outline">Taxonomy</Badge>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            No ISO 14001 environmental policy evidence
          </span>
          <span style={muted}>
            Referenced by 3 active bids, but no source document is linked in the
            knowledge base.
          </span>
          <div
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}
          >
            <Badge variant="secondary">Environmental</Badge>
            <Badge variant="secondary">Compliance</Badge>
          </div>
        </div>
        <Button variant="outline" style={{ flex: '0 0 auto' }}>
          Close gap <ArrowRight />
        </Button>
      </CardContent>
    </Card>
  );
}

// RECIPE — Feed source card: a sector-intelligence ingest source. Status dot,
// name + URL, source-type / cadence / last-polled metadata, active toggle.
export function FeedSource() {
  return (
    <Card style={{ width: 460 }}>
      <CardContent
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minWidth: 0,
            }}
          >
            <Dot color="var(--success)" />
            <div
              style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                Gov.UK Contracts Finder
              </span>
              <span
                style={{
                  ...muted,
                  fontSize: 13,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                contractsfinder.service.gov.uk <ExternalLink size={12} />
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 2, flex: '0 0 auto' }}>
            <Button variant="ghost" size="icon-sm" aria-label="Edit source">
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Delete source">
              <Trash2 />
            </Button>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
            fontSize: 13,
          }}
        >
          <Badge variant="outline">
            <Rss size={12} /> RSS
          </Badge>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              color: 'var(--muted-foreground)',
            }}
          >
            <Clock size={13} /> Every 30m
          </span>
          <span style={{ color: 'var(--muted-foreground)' }}>
            · Polled 2h ago
          </span>
        </div>
        <Separator />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Badge>Active</Badge>
          <Button variant="outline" size="sm">
            Archive
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// RECIPE — Template completion summary: post-fill outcome of a bid template.
// Confirmed/skipped/failed stat grid plus the download + refill actions.
export function TemplateCompletion() {
  const cell: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '12px 8px',
    borderRadius: 8,
    background: 'var(--muted)',
  };
  return (
    <Card style={{ width: 460 }}>
      <CardHeader>
        <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2
            size={18}
            style={{ color: 'var(--template-confirmed)' }}
          />{' '}
          Template completed
        </CardTitle>
        <CardDescription>SQ — standard selection questionnaire</CardDescription>
      </CardHeader>
      <CardContent
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
          }}
        >
          <div style={cell}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--template-confirmed)',
              }}
            >
              38
            </span>
            <span style={muted}>Fields filled</span>
          </div>
          <div style={cell}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--template-manual)',
              }}
            >
              4
            </span>
            <span style={muted}>Skipped</span>
          </div>
          <div style={cell}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--template-unmapped)',
              }}
            >
              1
            </span>
            <span style={muted}>Failed</span>
          </div>
        </div>
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button>
          <Download /> Download filled
        </Button>
        <Button variant="outline">
          <RefreshCw /> Refill with updated content
        </Button>
      </CardFooter>
    </Card>
  );
}
