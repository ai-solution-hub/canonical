/**
 * PDF report document for verification history export.
 *
 * Uses @react-pdf/renderer — server-side only (rendered in the API route).
 * A4 paper, 20mm margins, Helvetica 10pt body, UK dates throughout.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface VerificationRow {
  id: string;
  content_item_id: string;
  action_type: string;
  performed_by: string;
  performed_at: string;
  note: string | null;
  title: string | null;
  reviewer_name: string;
  governance_status: string | null;
}

interface ReportDocumentProps {
  rows: VerificationRow[];
  from: string;
  to: string;
  generatedBy: string;
  organisationName?: string;
}

// ──────────────────────────────────────────
// Date formatting helpers (UK format)
// ──────────────────────────────────────────

function formatDateUK(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return iso;
  }
}

function formatDateTimeUK(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch {
    return iso;
  }
}

function formatGeneratedAt(): string {
  const now = new Date();
  // Format in Europe/London timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(now);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function humaniseAction(action: string): string {
  const map: Record<string, string> = {
    verify: 'Verified',
    unverify: 'Unverified',
    flag: 'Flagged',
    unflag: 'Unflagged',
    skip: 'Skipped',
    approve: 'Approved',
    request_changes: 'Requested changes',
    revert: 'Reverted',
  };
  return map[action] ?? action;
}

function getDayKey(iso: string): string {
  return formatDateUK(iso);
}

// ──────────────────────────────────────────
// Styles
// ──────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 56, // 20mm
    paddingBottom: 56,
    paddingLeft: 56,
    paddingRight: 56,
    fontFamily: 'Helvetica',
    fontSize: 10,
  },
  header: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    paddingBottom: 8,
  },
  orgName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  headerMeta: {
    fontSize: 8,
    color: '#666666',
    marginBottom: 2,
  },
  dayDivider: {
    marginTop: 12,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#999999',
  },
  dayLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#444444',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 0.25,
    borderBottomColor: '#eeeeee',
  },
  rowTitle: {
    width: '30%',
    fontSize: 9,
    paddingRight: 4,
  },
  rowStatus: {
    width: '12%',
    fontSize: 8,
    color: '#555555',
  },
  rowReviewer: {
    width: '15%',
    fontSize: 8,
    color: '#555555',
  },
  rowTime: {
    width: '13%',
    fontSize: 8,
    color: '#555555',
  },
  rowAction: {
    width: '10%',
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#333333',
  },
  rowNote: {
    width: '20%',
    fontSize: 8,
    color: '#666666',
  },
  emptyMessage: {
    marginTop: 40,
    textAlign: 'center',
    fontSize: 12,
    color: '#888888',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 56,
    right: 56,
    fontSize: 7,
    color: '#999999',
    textAlign: 'center',
  },
});

// ──────────────────────────────────────────
// Components
// ──────────────────────────────────────────

function Header({
  organisationName,
  from,
  to,
  generatedBy,
  rowCount,
}: {
  organisationName: string;
  from: string;
  to: string;
  generatedBy: string;
  rowCount: number;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.orgName}>{organisationName}</Text>
      <Text style={styles.headerMeta}>Verification History Report</Text>
      <Text style={styles.headerMeta}>
        Period: {formatDateUK(from)} to {formatDateUK(to)}
      </Text>
      <Text style={styles.headerMeta}>
        Generated: {formatGeneratedAt()} | By: {generatedBy} | {rowCount}{' '}
        {rowCount === 1 ? 'event' : 'events'}
      </Text>
    </View>
  );
}

function DayGroup({ date }: { date: string }) {
  return (
    <View style={styles.dayDivider}>
      <Text style={styles.dayLabel}>{date}</Text>
    </View>
  );
}

function EventRow({ row }: { row: VerificationRow }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.rowTitle}>
        {truncate(row.title ?? 'Untitled', 80)}
      </Text>
      <Text style={styles.rowStatus}>{row.governance_status ?? '-'}</Text>
      <Text style={styles.rowReviewer}>{truncate(row.reviewer_name, 25)}</Text>
      <Text style={styles.rowTime}>{formatDateTimeUK(row.performed_at)}</Text>
      <Text style={styles.rowAction}>{humaniseAction(row.action_type)}</Text>
      <Text style={styles.rowNote}>
        {row.note ? truncate(row.note, 280) : '-'}
      </Text>
    </View>
  );
}

function Footer({ from, to }: { from: string; to: string }) {
  return (
    <Text
      style={styles.footer}
      render={({ pageNumber, totalPages }) =>
        `Knowledge Hub verification history \u2014 ${formatDateUK(from)}\u2013${formatDateUK(to)} \u2014 Page ${pageNumber} of ${totalPages}`
      }
      fixed
    />
  );
}

// ──────────────────────────────────────────
// Main document
// ──────────────────────────────────────────

export default function ReportDocument({
  rows,
  from,
  to,
  generatedBy,
  organisationName = 'Knowledge Hub',
}: ReportDocumentProps) {
  // Group rows by day
  const dayGroups = new Map<string, VerificationRow[]>();
  for (const row of rows) {
    const key = getDayKey(row.performed_at);
    const group = dayGroups.get(key) ?? [];
    group.push(row);
    dayGroups.set(key, group);
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Header
          organisationName={organisationName}
          from={from}
          to={to}
          generatedBy={generatedBy}
          rowCount={rows.length}
        />

        {rows.length === 0 ? (
          <Text style={styles.emptyMessage}>
            No verification events in this date range.
          </Text>
        ) : (
          Array.from(dayGroups.entries()).map(([day, dayRows]) => (
            <View key={day}>
              <DayGroup date={day} />
              {dayRows.map((row) => (
                <EventRow key={row.id} row={row} />
              ))}
            </View>
          ))
        )}

        <Footer from={from} to={to} />
      </Page>
    </Document>
  );
}
