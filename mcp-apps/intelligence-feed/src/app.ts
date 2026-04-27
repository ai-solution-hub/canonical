import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import type { IntelligenceSummaryData, IntelligenceArticle } from './types';
import './styles.css';

// ── App setup ──────────────────────────────────────────────

const app = new App({ name: 'Intelligence Feed', version: '1.0.0' });

const root = document.getElementById('app')!;
let feedData: IntelligenceSummaryData | null = null;

// ── Initial state: loading ────────────────────────────────

renderLoading();

// ── Host context integration ──────────────────────────────

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
    const data = result.structuredContent as unknown as IntelligenceSummaryData;
    if (!data || typeof data.total_ingested !== 'number') {
      const text = result.content?.find(
        (c: { type: string }) => c.type === 'text',
      ) as { text?: string } | undefined;
      renderEmpty(text?.text ?? 'No intelligence data available.');
      return;
    }
    feedData = data;
    renderFeed();
  } catch {
    renderEmpty('Failed to parse intelligence data.');
  }
};

app.ontoolinput = () => {
  renderLoading();
};

app.ontoolcancelled = () => {
  renderEmpty('Intelligence feed request was cancelled.');
};

app.onerror = (error) => {
  renderEmpty(`Connection error: ${error?.message ?? 'Unknown error'}`);
};

app.onhostcontextchanged = handleHostContextChanged;

app.onteardown = async () => {
  feedData = null;
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
// All user-facing text is set via textContent/createTextNode.
// No innerHTML — XSS prevention.

function renderLoading(): void {
  clearElement(root);
  const container = createElement('div', {
    className: 'loading-state',
    attrs: { role: 'status', 'aria-label': 'Loading intelligence data' },
  });
  const spinner = createElement('div', {
    className: 'loading-spinner',
    attrs: { 'aria-hidden': 'true' },
  });
  const text = createElement('p');
  text.textContent = 'Waiting for intelligence data\u2026';
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
  icon.textContent = '\u{1F4E1}';
  const text = createElement('p');
  text.textContent = message;
  container.appendChild(icon);
  container.appendChild(text);
  root.appendChild(container);
}

function renderFeed(): void {
  if (!feedData) return;

  clearElement(root);

  // Header
  const header = createElement('header', { className: 'feed-header' });
  const title = createElement('h1', { className: 'feed-title' });
  title.textContent = `Intelligence Feed: ${feedData.workspace_name}`;
  header.appendChild(title);

  const period = createElement('p', { className: 'feed-period' });
  period.textContent = feedData.period_label;
  header.appendChild(period);
  root.appendChild(header);

  // Stats bar
  root.appendChild(buildStatsBar());

  // Category breakdown
  const categoryEntries = Object.entries(feedData.by_category);
  if (categoryEntries.length > 0) {
    root.appendChild(buildCategorySection(categoryEntries));
  }

  // Top articles
  root.appendChild(buildArticlesSection());
}

function buildStatsBar(): HTMLElement {
  const data = feedData!;
  const bar = createElement('div', {
    className: 'stats-bar',
    attrs: { role: 'region', 'aria-label': 'Feed statistics' },
  });

  const cells: Array<{ label: string; value: string }> = [
    { label: 'Passed', value: String(data.total_passed) },
    { label: 'Filtered', value: String(data.total_filtered) },
    {
      label: 'Filter rate',
      value: `${Math.round(data.filter_ratio * 100)}%`,
    },
    { label: 'Flags', value: String(data.unresolved_flags) },
  ];

  for (const cell of cells) {
    const cellEl = createElement('div', { className: 'stats-cell' });
    const valueEl = createElement('div', { className: 'stats-cell-value' });
    valueEl.textContent = cell.value;
    const labelEl = createElement('div', { className: 'stats-cell-label' });
    labelEl.textContent = cell.label;
    cellEl.appendChild(valueEl);
    cellEl.appendChild(labelEl);
    bar.appendChild(cellEl);
  }

  return bar;
}

function buildCategorySection(entries: Array<[string, number]>): HTMLElement {
  const section = createElement('div', { className: 'category-section' });
  const title = createElement('h2', { className: 'category-section-title' });
  title.textContent = 'Categories';
  section.appendChild(title);

  const tags = createElement('div', { className: 'category-tags' });
  for (const [name, count] of entries) {
    const pill = createElement('span', { className: 'category-pill' });
    const nameNode = document.createTextNode(name);
    pill.appendChild(nameNode);
    pill.appendChild(document.createTextNode(' '));
    const countSpan = createElement('span', {
      className: 'category-pill-count',
    });
    countSpan.textContent = String(count);
    pill.appendChild(countSpan);
    tags.appendChild(pill);
  }
  section.appendChild(tags);

  return section;
}

function buildArticlesSection(): HTMLElement {
  const data = feedData!;
  const section = createElement('div', { className: 'articles-section' });
  const title = createElement('h2', { className: 'articles-section-title' });
  title.textContent = 'Top Articles';
  section.appendChild(title);

  if (data.top_articles.length === 0) {
    const empty = createElement('p', { className: 'empty-state' });
    empty.textContent = 'No articles passed filters in this period.';
    section.appendChild(empty);
    return section;
  }

  for (const article of data.top_articles) {
    section.appendChild(buildArticleCard(article));
  }

  return section;
}

function buildArticleCard(article: IntelligenceArticle): HTMLElement {
  const card = createElement('div', { className: 'article-card' });

  // Header row: score badge, source, date
  const headerRow = createElement('div', { className: 'article-card-header' });

  // Score badge
  const badgeClass = getScoreBadgeClass(article.relevance_score);
  const badge = createElement('span', {
    className: `score-badge ${badgeClass}`,
  });
  badge.textContent = `${Math.round(article.relevance_score * 100)}%`;
  headerRow.appendChild(badge);

  // Source
  const source = createElement('span', { className: 'article-source' });
  source.textContent = article.source_name;
  headerRow.appendChild(source);

  // Date (DD/MM/YYYY)
  const dateStr = formatDateUK(article.published_at ?? article.ingested_at);
  const dateEl = createElement('span', { className: 'article-date' });
  dateEl.textContent = dateStr;
  headerRow.appendChild(dateEl);

  card.appendChild(headerRow);

  // Title (linked)
  const titleEl = createElement('div', { className: 'article-title' });
  const link = document.createElement('a');
  link.href = article.external_url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = article.title;
  titleEl.appendChild(link);
  card.appendChild(titleEl);

  // AI summary
  if (article.ai_summary) {
    const summary = createElement('div', { className: 'article-summary' });
    summary.textContent = article.ai_summary;
    card.appendChild(summary);
  }

  // Category pills
  if (article.matched_categories.length > 0) {
    const categories = createElement('div', {
      className: 'article-categories',
    });
    for (const cat of article.matched_categories) {
      const pill = createElement('span', {
        className: 'article-category-pill',
      });
      pill.textContent = cat;
      categories.appendChild(pill);
    }
    card.appendChild(categories);
  }

  return card;
}

// ── Helpers ─────────────────────────────────────────────────

function getScoreBadgeClass(score: number): string {
  if (score >= 0.8) return 'score-badge--high';
  if (score >= 0.5) return 'score-badge--medium';
  return 'score-badge--low';
}

/**
 * Format a date string as DD/MM/YYYY (UK format).
 */
function formatDateUK(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
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
