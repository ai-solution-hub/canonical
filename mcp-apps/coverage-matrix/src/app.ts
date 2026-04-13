import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import type {
  CoverageMatrixData,
  DomainRow,
  DetailPanelState,
  SearchResultItem,
  FreshnessKey,
} from './types';
import { FRESHNESS_LABELS } from './types';
import './styles.css';

// ── App setup ──────────────────────────────────────────────

const app = new App({ name: 'Coverage Matrix', version: '1.0.0' });

const root = document.getElementById('app')!;
let matrixData: CoverageMatrixData | null = null;
let domainRows: DomainRow[] = [];
let showGapsOnly = false;
let detailPanel: DetailPanelState | null = null;
let maxCellCount = 1; // Maximum count across all freshness cells, for density scaling

// ── Initial state: loading ────────────────────────────────

renderLoading();

// ── Host context integration ──────────────────────────────
// Apply host theme, style variables, and fonts so the app
// visually matches the host (Claude Desktop, Claude.ai, etc.)

function handleHostContextChanged(ctx: McpUiHostContext): void {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
}

// ── Register all handlers BEFORE app.connect() ────────────

app.ontoolresult = (result) => {
  try {
    const data = result.structuredContent as unknown as CoverageMatrixData;
    if (!data || typeof data.total_items !== 'number') {
      // Fall back to showing Markdown content if structuredContent is missing
      const text = result.content?.find(
        (c: { type: string }) => c.type === 'text',
      ) as { text?: string } | undefined;
      renderEmpty(text?.text ?? 'No coverage data available.');
      return;
    }
    matrixData = data;
    domainRows = data.domains
      .map((d) => ({ ...d, expanded: false }))
      .sort((a, b) => a.name.localeCompare(b.name));
    maxCellCount = computeMaxCellCount(data);
    renderMatrix();
  } catch {
    renderEmpty('Failed to parse coverage data.');
  }
};

app.ontoolinput = () => {
  // Show loading state when the host begins streaming tool input
  renderLoading();
};

app.ontoolcancelled = () => {
  renderEmpty('Coverage analysis was cancelled.');
};

app.onerror = (error) => {
  renderEmpty(`Connection error: ${error?.message ?? 'Unknown error'}`);
};

app.onhostcontextchanged = handleHostContextChanged;

app.onteardown = async () => {
  // Clean up resources when the host tears down the view
  matrixData = null;
  domainRows = [];
  return {};
};

// ── Connect to host and apply initial context ─────────────

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});

// ── Render functions ──────────────────────────────────────
// Note: All user-facing text is set via textContent/createTextNode,
// avoiding innerHTML entirely. This eliminates XSS risk. Data comes
// exclusively from the MCP server (same-origin tool results).

function renderLoading(): void {
  clearElement(root);
  const container = createElement('div', {
    className: 'loading-state',
    attrs: { role: 'status', 'aria-label': 'Loading coverage data' },
  });
  const spinner = createElement('div', {
    className: 'loading-spinner',
    attrs: { 'aria-hidden': 'true' },
  });
  const text = createElement('p');
  text.textContent = 'Waiting for coverage data\u2026';
  container.appendChild(spinner);
  container.appendChild(text);
  root.appendChild(container);
}

function renderEmpty(message: string): void {
  clearElement(root);
  const container = createElement('div', {
    className: 'empty-state',
    attrs: { role: 'status' },
  });
  const icon = createElement('div', {
    className: 'empty-state-icon',
    attrs: { 'aria-hidden': 'true' },
  });
  icon.textContent = '\u{1F4CA}';
  const text = createElement('p');
  text.textContent = message;
  container.appendChild(icon);
  container.appendChild(text);
  root.appendChild(container);
}

function renderMatrix(): void {
  if (!matrixData) return;

  const { total_items, freshness, quality, gaps } = matrixData;
  const filteredDomains = showGapsOnly
    ? domainRows.filter((d) => hasGaps(d.name))
    : domainRows;

  clearElement(root);

  // Header
  const header = createElement('header', { className: 'matrix-header' });
  const title = createElement('h1', { className: 'matrix-title' });
  title.textContent = 'Coverage Matrix';
  const subtitle = createElement('p', { className: 'matrix-subtitle' });
  subtitle.textContent =
    'Knowledge base coverage by domain and freshness state';
  header.appendChild(title);
  header.appendChild(subtitle);
  root.appendChild(header);

  // Summary bar
  root.appendChild(buildSummaryBar(total_items, freshness));

  // Freshness bar
  root.appendChild(buildFreshnessBar(total_items, freshness));

  // Controls
  root.appendChild(buildControls(quality, gaps));

  // Table or empty
  if (filteredDomains.length === 0) {
    const empty = createElement('div', {
      className: 'empty-state',
      attrs: { role: 'status' },
    });
    const p = createElement('p');
    p.textContent = 'No domains match the current filter.';
    empty.appendChild(p);
    root.appendChild(empty);
  } else {
    root.appendChild(buildTable(filteredDomains));
  }

  // Gaps section
  if (gaps.length > 0) {
    root.appendChild(buildGapsSection(gaps));
  }
}

function buildSummaryBar(
  total: number,
  freshness: CoverageMatrixData['freshness'],
): HTMLElement {
  const bar = createElement('div', {
    className: 'summary-bar',
    attrs: { role: 'region', 'aria-label': 'Freshness summary' },
  });

  const cards: Array<{
    label: string;
    value: number;
    modifier?: string;
  }> = [
    { label: 'Total Items', value: total },
    { label: 'Fresh', value: freshness.fresh, modifier: 'fresh' },
    { label: 'Ageing', value: freshness.aging, modifier: 'aging' },
    { label: 'Stale', value: freshness.stale, modifier: 'stale' },
    { label: 'Expired', value: freshness.expired, modifier: 'expired' },
  ];

  for (const card of cards) {
    const cardEl = createElement('div', {
      className: card.modifier
        ? `summary-card summary-card--${card.modifier}`
        : 'summary-card',
    });
    const labelEl = createElement('div', { className: 'summary-card-label' });
    labelEl.textContent = card.label;
    const valueEl = createElement('div', { className: 'summary-card-value' });
    valueEl.textContent = String(card.value);
    cardEl.appendChild(labelEl);
    cardEl.appendChild(valueEl);
    bar.appendChild(cardEl);
  }

  return bar;
}

function buildFreshnessBar(
  total: number,
  freshness: CoverageMatrixData['freshness'],
): HTMLElement {
  const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0');

  const bar = createElement('div', {
    className: 'freshness-bar',
    attrs: {
      role: 'img',
      'aria-label': `Freshness distribution: ${pct(freshness.fresh)}% fresh, ${pct(freshness.aging)}% ageing, ${pct(freshness.stale)}% stale, ${pct(freshness.expired)}% expired`,
    },
  });

  const states: Array<{
    key: keyof typeof freshness;
    cls: string;
  }> = [
    { key: 'fresh', cls: 'freshness-bar-segment--fresh' },
    { key: 'aging', cls: 'freshness-bar-segment--aging' },
    { key: 'stale', cls: 'freshness-bar-segment--stale' },
    { key: 'expired', cls: 'freshness-bar-segment--expired' },
  ];

  for (const state of states) {
    const segment = createElement('div', {
      className: `freshness-bar-segment ${state.cls}`,
    });
    segment.style.width = `${pct(freshness[state.key])}%`;
    bar.appendChild(segment);
  }

  return bar;
}

function buildControls(
  quality: CoverageMatrixData['quality'],
  gaps: CoverageMatrixData['gaps'],
): HTMLElement {
  const controls = createElement('div', { className: 'controls' });

  const label = createElement('label', { className: 'toggle-label' });
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'gaps-toggle';
  checkbox.checked = showGapsOnly;
  checkbox.addEventListener('change', () => {
    showGapsOnly = checkbox.checked;
    renderMatrix();
  });
  const labelText = document.createTextNode(' Show gaps only');
  label.appendChild(checkbox);
  label.appendChild(labelText);
  controls.appendChild(label);

  const badgeContainer = createElement('div');

  if (quality.total_flagged > 0) {
    const badge = createElement('span', {
      className: 'quality-badge',
      attrs: {
        'aria-label': `${quality.total_flagged} quality issues flagged`,
      },
    });
    const icon = createElement('span', { attrs: { 'aria-hidden': 'true' } });
    icon.textContent = '\u26A0';
    badge.appendChild(icon);
    badge.appendChild(
      document.createTextNode(` ${quality.total_flagged} flagged`),
    );
    badgeContainer.appendChild(badge);
  }

  if (gaps.length > 0) {
    const badge = createElement('span', {
      className: 'quality-badge',
      attrs: {
        'aria-label': `${gaps.length} coverage gaps identified`,
      },
    });
    badge.textContent = `${gaps.length} gap${gaps.length !== 1 ? 's' : ''}`;
    badgeContainer.appendChild(badge);
  }

  controls.appendChild(badgeContainer);
  return controls;
}

function buildTable(domains: DomainRow[]): HTMLElement {
  const table = createElement('table', {
    className: 'matrix-table',
    attrs: {
      'aria-label': 'Coverage matrix by domain and freshness',
    },
  });

  // thead
  const thead = createElement('thead');
  const headerRow = createElement('tr');
  const headers = ['Domain', 'Fresh', 'Ageing', 'Stale', 'Expired', 'Total'];
  for (const h of headers) {
    const th = createElement('th', { attrs: { scope: 'col' } });
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // tbody
  const tbody = createElement('tbody');

  for (const domain of domains) {
    const gapCount = getGapCount(domain.name);
    const domainTr = createElement('tr', {
      className: 'domain-row',
      attrs: {
        tabindex: '0',
        role: 'button',
        'aria-expanded': String(domain.expanded),
        'data-domain': domain.name,
      },
    });

    // Domain name cell
    const nameTd = createElement('td');
    const nameSpan = createElement('span', { className: 'domain-name' });

    const chevron = createElement('span', {
      className: `domain-chevron${domain.expanded ? ' domain-chevron--expanded' : ''}`,
      attrs: { 'aria-hidden': 'true' },
    });
    chevron.textContent = '\u25B6';
    nameSpan.appendChild(chevron);
    nameSpan.appendChild(document.createTextNode(` ${domain.name}`));

    if (gapCount > 0) {
      const gapInd = createElement('span', { className: 'gap-indicator' });
      gapInd.textContent = `${gapCount} gap${gapCount !== 1 ? 's' : ''}`;
      nameSpan.appendChild(document.createTextNode(' '));
      nameSpan.appendChild(gapInd);
    }

    nameTd.appendChild(nameSpan);
    domainTr.appendChild(nameTd);

    // Freshness cells
    appendFreshnessCells(domainTr, domain, false, domain.name);

    // Total cell with drill-down button
    const totalTd = createElement('td', { className: 'cell--total' });
    if (domain.total_items > 0) {
      const drillBtn = createElement('button', {
        className: 'drill-btn',
        attrs: {
          type: 'button',
          'aria-label': `View ${domain.total_items} items in ${domain.name}`,
          title: 'View items',
        },
      });
      drillBtn.textContent = String(domain.total_items);
      drillBtn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        drillDown(domain.name);
      });
      totalTd.appendChild(drillBtn);
    } else {
      totalTd.textContent = '0';
    }
    domainTr.appendChild(totalTd);

    // Click/keyboard handlers (expand/collapse subtopics)
    const toggleHandler = () => toggleDomain(domain.name);
    domainTr.addEventListener('click', toggleHandler);
    domainTr.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        toggleHandler();
      }
    });

    tbody.appendChild(domainTr);

    // Subtopic rows (if expanded)
    if (domain.expanded && domain.subtopics.length > 0) {
      for (const sub of domain.subtopics) {
        const isGap = isSubtopicGap(domain.name, sub.name);
        const subTr = createElement('tr', { className: 'subtopic-row' });

        const subNameTd = createElement('td');
        const subNameSpan = createElement('span', {
          className: 'subtopic-name',
        });
        subNameSpan.textContent = sub.name;
        subNameTd.appendChild(subNameSpan);
        subTr.appendChild(subNameTd);

        appendFreshnessCells(subTr, sub, isGap, domain.name, sub.name);

        const subTotalTd = createElement('td', { className: 'cell--total' });
        if (sub.total_items > 0) {
          const subDrillBtn = createElement('button', {
            className: 'drill-btn',
            attrs: {
              type: 'button',
              'aria-label': `View ${sub.total_items} items in ${domain.name} > ${sub.name}`,
              title: 'View items',
            },
          });
          subDrillBtn.textContent = String(sub.total_items);
          subDrillBtn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            drillDown(domain.name, sub.name);
          });
          subTotalTd.appendChild(subDrillBtn);
        } else {
          subTotalTd.textContent = '0';
        }
        subTr.appendChild(subTotalTd);

        tbody.appendChild(subTr);
      }
    }
  }

  table.appendChild(tbody);
  return table;
}

function appendFreshnessCells(
  row: HTMLElement,
  item: { fresh: number; aging: number; stale: number; expired: number },
  isGap: boolean,
  domainName: string,
  subtopicName?: string,
): void {
  const states: Array<{
    key: FreshnessKey;
    cls: string;
  }> = [
    { key: 'fresh', cls: 'cell--fresh' },
    { key: 'aging', cls: 'cell--aging' },
    { key: 'stale', cls: 'cell--stale' },
    { key: 'expired', cls: 'cell--expired' },
  ];

  // Check whether this domain has a stale_only gap (for quality indicator)
  const hasStaleOnlyGap = matrixData
    ? matrixData.gaps.some(
        (g) =>
          g.domain === domainName &&
          g.issue === 'stale_only' &&
          (subtopicName ? g.subtopic === subtopicName : true),
      )
    : false;

  for (const state of states) {
    const count = item[state.key];
    let className: string;
    if (count === 0 && isGap) {
      className = 'cell--gap';
    } else if (count === 0) {
      className = 'cell--zero';
    } else {
      className = state.cls;
    }
    const td = createElement('td', { className });

    // Heat map density: compute background lightness based on count.
    // Higher counts → lower lightness (darker/more saturated background).
    // Lightness ranges from 0.96 (low density) to 0.82 (high density)
    // in light mode. Text colour stays constant for WCAG contrast.
    if (count > 0) {
      const ratio = count / maxCellCount; // 0..1
      const bgColor = getCellDensityBg(state.key, ratio);
      td.style.setProperty('--cell-bg', bgColor);
      td.classList.add('cell--has-density');
    }

    if (count > 0) {
      // Clickable cell: drill down filtered by freshness state
      const label = FRESHNESS_LABELS[state.key];
      const context = subtopicName
        ? `${domainName} > ${subtopicName}`
        : domainName;
      const drillBtn = createElement('button', {
        className: 'drill-btn drill-btn--cell',
        attrs: {
          type: 'button',
          'aria-label': `View ${count} ${label.toLowerCase()} items in ${context}`,
          title: `${label}: ${count} item${count !== 1 ? 's' : ''}`,
        },
      });
      drillBtn.textContent = String(count);
      drillBtn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        drillDown(domainName, subtopicName, state.key);
      });
      td.appendChild(drillBtn);
    } else {
      td.textContent = '0';
    }

    // Quality indicator: small dot for stale_only gap cells
    // Show on stale and expired cells when the domain/subtopic has a stale_only gap
    if (
      hasStaleOnlyGap &&
      (state.key === 'stale' || state.key === 'expired') &&
      count > 0
    ) {
      const dot = createElement('span', {
        className: 'cell-quality-dot',
        attrs: {
          'aria-label': 'Quality concern: all content is stale or expired',
          title: 'All content ageing or expired',
        },
      });
      dot.textContent = '\u26A0';
      td.appendChild(dot);
      td.classList.add('cell--has-quality-indicator');
    }

    row.appendChild(td);
  }
}

function buildGapsSection(gaps: CoverageMatrixData['gaps']): HTMLElement {
  const issueLabels: Record<string, string> = {
    empty: 'No content',
    thin: 'Thin coverage',
    stale_only: 'All stale/expired',
  };

  const section = createElement('section', {
    className: 'gaps-section',
    attrs: { 'aria-label': 'Coverage gaps' },
  });

  const heading = createElement('h2', { className: 'gaps-title' });
  const headingIcon = createElement('span', {
    attrs: { 'aria-hidden': 'true' },
  });
  headingIcon.textContent = '\u26A0';
  heading.appendChild(headingIcon);
  heading.appendChild(document.createTextNode(' Coverage Gaps'));
  section.appendChild(heading);

  const list = createElement('div', { className: 'gaps-list' });

  for (const gap of gaps) {
    const card = createElement('div', { className: 'gap-card' });

    const left = createElement('div', { className: 'gap-card-left' });
    const domainSpan = createElement('span', {
      className: 'gap-card-domain',
    });
    domainSpan.textContent = gap.domain;
    left.appendChild(domainSpan);

    if (gap.subtopic) {
      const subSpan = createElement('span', {
        className: 'gap-card-subtopic',
      });
      subSpan.textContent = gap.subtopic;
      left.appendChild(subSpan);
    }

    card.appendChild(left);

    const issueSpan = createElement('span', {
      className: `gap-card-issue gap-card-issue--${gap.issue}`,
    });
    let issueText = issueLabels[gap.issue] ?? gap.issue;
    if (gap.item_count > 0) {
      issueText += ` (${gap.item_count})`;
    }
    issueSpan.textContent = issueText;
    card.appendChild(issueSpan);

    list.appendChild(card);
  }

  section.appendChild(list);
  return section;
}

// ── Domain toggle ─────────────────────────────────────────

function toggleDomain(name: string): void {
  const domain = domainRows.find((d) => d.name === name);
  if (domain) {
    domain.expanded = !domain.expanded;
    renderMatrix();
  }
}

// ── Gap helpers ───────────────────────────────────────────

function hasGaps(domainName: string): boolean {
  if (!matrixData) return false;
  return matrixData.gaps.some((g) => g.domain === domainName);
}

function getGapCount(domainName: string): number {
  if (!matrixData) return 0;
  return matrixData.gaps.filter((g) => g.domain === domainName).length;
}

function isSubtopicGap(domain: string, subtopic: string): boolean {
  if (!matrixData) return false;
  return matrixData.gaps.some(
    (g) => g.domain === domain && g.subtopic === subtopic,
  );
}

// ── Drill-down via callServerTool ──────────────────────────

async function drillDown(
  domain: string,
  subtopic?: string,
  freshnessFilter?: FreshnessKey,
): Promise<void> {
  detailPanel = {
    domain,
    subtopic,
    freshnessFilter: freshnessFilter
      ? FRESHNESS_LABELS[freshnessFilter]
      : undefined,
    loading: true,
    items: [],
  };
  renderDetailPanel();

  try {
    const queryParts = [domain];
    if (subtopic) queryParts.push(subtopic);
    if (freshnessFilter) queryParts.push(freshnessFilter);
    const query = queryParts.join(' ');
    const result = await app.callServerTool({
      name: 'search_knowledge_base',
      arguments: { query, domain, limit: 15 },
    });

    const structured = result.structuredContent as unknown as {
      results?: SearchResultItem[];
    };
    detailPanel = {
      domain,
      subtopic,
      freshnessFilter: freshnessFilter
        ? FRESHNESS_LABELS[freshnessFilter]
        : undefined,
      loading: false,
      items: structured?.results ?? [],
    };
  } catch (err) {
    detailPanel = {
      domain,
      subtopic,
      freshnessFilter: freshnessFilter
        ? FRESHNESS_LABELS[freshnessFilter]
        : undefined,
      loading: false,
      items: [],
      error: err instanceof Error ? err.message : 'Search failed',
    };
  }

  renderDetailPanel();
}

function closeDetailPanel(): void {
  detailPanel = null;
  const panel = document.getElementById('detail-panel');
  if (panel) panel.remove();
}

function renderDetailPanel(): void {
  let panel = document.getElementById('detail-panel');
  if (!detailPanel) {
    if (panel) panel.remove();
    return;
  }

  if (!panel) {
    panel = createElement('aside', {
      className: 'detail-panel',
      attrs: { id: 'detail-panel', 'aria-label': 'Domain detail' },
    });
    root.appendChild(panel);
  }

  clearElement(panel);

  // Header
  const header = createElement('div', { className: 'detail-header' });
  const title = createElement('h2', { className: 'detail-title' });
  let titleText = detailPanel.domain;
  if (detailPanel.subtopic) {
    titleText += ` \u203A ${detailPanel.subtopic}`;
  }
  if (detailPanel.freshnessFilter) {
    titleText += ` \u203A ${detailPanel.freshnessFilter}`;
  }
  title.textContent = titleText;
  header.appendChild(title);

  const closeBtn = createElement('button', {
    className: 'detail-close',
    attrs: { 'aria-label': 'Close detail panel', type: 'button' },
  });
  closeBtn.textContent = '\u2715';
  closeBtn.addEventListener('click', closeDetailPanel);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Content
  if (detailPanel.loading) {
    const loading = createElement('div', {
      className: 'detail-loading',
      attrs: { role: 'status' },
    });
    loading.textContent = 'Searching knowledge base\u2026';
    panel.appendChild(loading);
    return;
  }

  if (detailPanel.error) {
    const error = createElement('div', { className: 'detail-error' });
    error.textContent = detailPanel.error;
    panel.appendChild(error);
    return;
  }

  if (detailPanel.items.length === 0) {
    const empty = createElement('div', { className: 'detail-empty' });
    empty.textContent = 'No items found in this area.';
    panel.appendChild(empty);
    return;
  }

  const count = createElement('p', { className: 'detail-count' });
  count.textContent = `${detailPanel.items.length} item${detailPanel.items.length !== 1 ? 's' : ''}`;
  panel.appendChild(count);

  const list = createElement('div', { className: 'detail-list' });
  for (const item of detailPanel.items) {
    const card = createElement('div', { className: 'detail-item' });

    const itemTitle = createElement('div', { className: 'detail-item-title' });
    itemTitle.textContent = item.suggested_title || item.title || 'Untitled';
    card.appendChild(itemTitle);

    const meta = createElement('div', { className: 'detail-item-meta' });
    const parts: string[] = [];
    if (item.content_type) parts.push(item.content_type.replace(/_/g, ' '));
    if (item.primary_subtopic) parts.push(item.primary_subtopic);
    parts.push(`${Math.round(item.similarity * 100)}% match`);
    meta.textContent = parts.join(' \u00B7 ');
    card.appendChild(meta);

    if (item.summary) {
      const summary = createElement('div', {
        className: 'detail-item-summary',
      });
      summary.textContent =
        item.summary.length > 200
          ? item.summary.slice(0, 197) + '\u2026'
          : item.summary;
      card.appendChild(summary);
    }

    list.appendChild(card);
  }
  panel.appendChild(list);
}

// ── Density computation ───────────────────────────────────

function computeMaxCellCount(data: CoverageMatrixData): number {
  let max = 1;
  for (const domain of data.domains) {
    max = Math.max(
      max,
      domain.fresh,
      domain.aging,
      domain.stale,
      domain.expired,
    );
    for (const sub of domain.subtopics) {
      max = Math.max(max, sub.fresh, sub.aging, sub.stale, sub.expired);
    }
  }
  return max;
}

/**
 * Detect whether the app is in dark mode via host data-theme attribute
 * or system prefers-color-scheme.
 */
function isDarkMode(): boolean {
  const root = document.documentElement;
  if (root.getAttribute('data-theme') === 'dark') return true;
  if (root.getAttribute('data-theme') === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Compute an oklch background colour for a freshness cell, varying lightness
 * by density ratio. Low density produces lighter backgrounds, high density
 * produces darker/more saturated backgrounds. Each freshness state uses its
 * own chroma and hue from the Warm Meridian palette.
 */
function getCellDensityBg(key: FreshnessKey, ratio: number): string {
  // Base chroma and hue per freshness state (from --freshness-*-bg tokens)
  const palette: Record<FreshnessKey, { c: number; h: number }> = {
    fresh: { c: 0.04, h: 160 },
    aging: { c: 0.02, h: 70 },
    stale: { c: 0.03, h: 20 },
    expired: { c: 0.03, h: 20 },
  };
  const { c, h } = palette[key];

  const dark = isDarkMode();
  // Light mode: lightness 0.96 (low density) → 0.82 (high density)
  // Dark mode: lightness 0.22 (low density) → 0.35 (high density)
  const l = dark ? 0.22 + ratio * 0.13 : 0.96 - ratio * 0.14;
  // Chroma increases slightly with density for more saturation
  const cScaled = dark ? 0.04 + ratio * 0.04 : c + ratio * 0.02;
  return `oklch(${l.toFixed(3)} ${cScaled.toFixed(4)} ${h})`;
}

// ── DOM utilities ─────────────────────────────────────────

interface CreateElementOptions {
  className?: string;
  attrs?: Record<string, string>;
}

function createElement(
  tag: string,
  options?: CreateElementOptions,
): HTMLElement {
  const el = document.createElement(tag);
  if (options?.className) {
    el.className = options.className;
  }
  if (options?.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

function clearElement(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}
