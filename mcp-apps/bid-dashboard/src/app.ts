import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import type {
  BidDashboardData,
  BidSummary,
  BidDetailData,
  BidQuestionSummary,
  BidQuestionDetailData,
  KBSearchResult,
  Urgency,
  ExpandedBidState,
  ExpandedQuestionState,
} from './types';
import './styles.css';

// -- App setup ---------------------------------------------------------------

const app = new App({ name: 'Bid Dashboard', version: '1.0.0' });

const root = document.getElementById('app')!;
let dashboardData: BidDashboardData | null = null;
let expandedBid: ExpandedBidState | null = null;

// -- Initial state: loading --------------------------------------------------

renderLoading();

// -- Host context integration ------------------------------------------------

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

// -- Register all handlers BEFORE app.connect() ------------------------------

app.ontoolresult = (result) => {
  try {
    const data = result.structuredContent as unknown as BidDashboardData;
    if (!data || !Array.isArray(data.bids)) {
      const text = result.content?.find(
        (c: { type: string }) => c.type === 'text',
      ) as { text?: string } | undefined;
      renderEmpty(text?.text ?? 'No bid data available.');
      return;
    }
    dashboardData = data;

    // If a focused bid detail was included, auto-expand it
    if (data.focused_bid_detail) {
      const detail = data.focused_bid_detail as unknown as BidDetailData;
      expandedBid = {
        bidId: detail.id,
        loading: false,
        detail,
        expandedQuestion: null,
      };
    }

    renderDashboard();
  } catch {
    renderEmpty('Failed to parse bid data.');
  }
};

app.ontoolinput = () => {
  renderLoading();
};

app.ontoolcancelled = () => {
  renderEmpty('Bid dashboard request was cancelled.');
};

app.onerror = (error) => {
  renderEmpty(`Connection error: ${error?.message ?? 'Unknown error'}`);
};

app.onhostcontextchanged = handleHostContextChanged;

app.onteardown = async () => {
  dashboardData = null;
  expandedBid = null;
  return {};
};

// -- Connect to host and apply initial context -------------------------------

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});

// -- Render functions --------------------------------------------------------
// All user-facing text is set via textContent/createTextNode — no innerHTML.

function renderLoading(): void {
  clearElement(root);
  const container = createElement('div', {
    className: 'loading-state',
    attrs: { role: 'status', 'aria-label': 'Loading bid data' },
  });
  const spinner = createElement('div', {
    className: 'loading-spinner',
    attrs: { 'aria-hidden': 'true' },
  });
  const text = createElement('p');
  text.textContent = 'Waiting for bid data\u2026';
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
  icon.textContent = '\u{1F4CB}';
  const text = createElement('p');
  text.textContent = message;
  container.appendChild(icon);
  container.appendChild(text);
  root.appendChild(container);
}

function renderDashboard(): void {
  if (!dashboardData) return;

  const { bids, total_count } = dashboardData;

  // Sort bids: overdue first, then by days_until_deadline ascending
  const sortedBids = [...bids].sort((a, b) => {
    const urgencyA = getUrgencyOrder(a);
    const urgencyB = getUrgencyOrder(b);
    return urgencyA - urgencyB;
  });

  clearElement(root);

  // Header
  const header = createElement('header', { className: 'dashboard-header' });
  const title = createElement('h1', { className: 'dashboard-title' });
  title.textContent = 'Bid Dashboard';
  const subtitle = createElement('p', { className: 'dashboard-subtitle' });
  subtitle.textContent = 'Active bids with progress and deadline tracking';
  header.appendChild(title);
  header.appendChild(subtitle);
  root.appendChild(header);

  // Summary bar
  root.appendChild(buildSummaryBar(sortedBids, total_count));

  // Bid cards
  if (sortedBids.length === 0) {
    const empty = createElement('div', {
      className: 'empty-state',
      attrs: { role: 'status' },
    });
    const p = createElement('p');
    p.textContent = 'No active bids found.';
    empty.appendChild(p);
    root.appendChild(empty);
  } else {
    const list = createElement('div', {
      className: 'bid-list',
      attrs: { role: 'list', 'aria-label': 'Active bids' },
    });
    for (const bid of sortedBids) {
      list.appendChild(buildBidCard(bid));
    }
    root.appendChild(list);
  }
}

function buildSummaryBar(bids: BidSummary[], totalCount: number): HTMLElement {
  const bar = createElement('div', {
    className: 'summary-bar',
    attrs: { role: 'region', 'aria-label': 'Bid pipeline summary' },
  });

  const overdueCount = bids.filter(
    (b) => b.days_until_deadline !== null && b.days_until_deadline < 0,
  ).length;
  const totalQuestions = bids.reduce((sum, b) => sum + b.total_questions, 0);
  const totalAnswered = bids.reduce((sum, b) => sum + b.answered_questions, 0);

  const cards: Array<{
    label: string;
    value: string;
    modifier?: string;
  }> = [
    { label: 'Total Bids', value: String(totalCount) },
    {
      label: 'Overdue',
      value: String(overdueCount),
      modifier: overdueCount > 0 ? 'overdue' : undefined,
    },
    {
      label: 'Questions',
      value: totalQuestions > 0 ? `${totalAnswered}/${totalQuestions}` : '0',
    },
    {
      label: 'Completion',
      value:
        totalQuestions > 0
          ? `${Math.round((totalAnswered / totalQuestions) * 100)}%`
          : '0%',
    },
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
    valueEl.textContent = card.value;
    cardEl.appendChild(labelEl);
    cardEl.appendChild(valueEl);
    bar.appendChild(cardEl);
  }

  return bar;
}

function buildBidCard(bid: BidSummary): HTMLElement {
  const urgency = getUrgency(bid.days_until_deadline);
  const isExpanded = expandedBid?.bidId === bid.id;

  const card = createElement('div', {
    className: buildCardClassName(urgency, isExpanded),
    attrs: {
      role: 'button',
      tabindex: '0',
      'aria-expanded': String(isExpanded),
      'aria-label': `${bid.name}${bid.buyer ? `, ${bid.buyer}` : ''} — ${bid.status}`,
      'data-bid-id': bid.id,
    },
  });

  // Header row
  const headerRow = createElement('div', { className: 'bid-card-header' });

  // Left side: name + buyer
  const left = createElement('div', { className: 'bid-card-left' });
  const name = createElement('div', { className: 'bid-card-name' });

  const chevron = createElement('span', {
    className: `bid-card-chevron${isExpanded ? ' bid-card-chevron--expanded' : ''}`,
    attrs: { 'aria-hidden': 'true' },
  });
  chevron.textContent = '\u25B6';
  name.appendChild(chevron);
  name.appendChild(document.createTextNode(` ${bid.name}`));
  left.appendChild(name);

  if (bid.buyer) {
    const buyer = createElement('div', { className: 'bid-card-buyer' });
    buyer.textContent = bid.buyer;
    left.appendChild(buyer);
  }

  headerRow.appendChild(left);

  // Right side: status + deadline badges
  const right = createElement('div', { className: 'bid-card-right' });
  right.appendChild(buildStatusBadge(bid.status));
  right.appendChild(buildDeadlineBadge(bid.deadline, bid.days_until_deadline));
  headerRow.appendChild(right);

  card.appendChild(headerRow);

  // Progress section
  card.appendChild(buildProgressSection(bid));

  // Click/keyboard handler for expand/collapse
  const toggleHandler = (e: Event) => {
    e.preventDefault();
    toggleBidExpansion(bid.id);
  };
  card.addEventListener('click', toggleHandler);
  card.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      toggleBidExpansion(bid.id);
    }
  });

  // Expanded detail section
  if (isExpanded && expandedBid) {
    card.appendChild(buildDetailSection(expandedBid));
  }

  return card;
}

function buildStatusBadge(status: string): HTMLElement {
  const validStatuses = ['draft', 'active', 'submitted', 'won', 'lost'];
  const modifier = validStatuses.includes(status) ? status : 'draft';
  const badge = createElement('span', {
    className: `status-badge status-badge--${modifier}`,
  });
  badge.textContent = status;
  return badge;
}

function buildDeadlineBadge(
  deadline: string | null,
  daysUntil: number | null,
): HTMLElement {
  const urgency = getUrgency(daysUntil);

  const badge = createElement('span', {
    className: `deadline-badge deadline-badge--${urgency}`,
    attrs: {
      'aria-label': formatDeadlineAriaLabel(deadline, daysUntil),
    },
  });

  badge.textContent = formatDeadlineText(deadline, daysUntil);
  return badge;
}

function buildProgressSection(bid: BidSummary): HTMLElement {
  const section = createElement('div', { className: 'bid-card-progress' });

  const labels = createElement('div', { className: 'progress-labels' });

  const answered = createElement('span', { className: 'progress-answered' });
  const pct =
    bid.total_questions > 0
      ? Math.round((bid.answered_questions / bid.total_questions) * 100)
      : 0;
  answered.textContent = `${bid.answered_questions}/${bid.total_questions} answered (${pct}%)`;
  labels.appendChild(answered);

  if (bid.approved_questions > 0) {
    const approved = createElement('span', { className: 'progress-approved' });
    approved.textContent = `${bid.approved_questions} approved`;
    labels.appendChild(approved);
  }

  section.appendChild(labels);

  // Progress bar with stacked layers
  const bar = createElement('div', {
    className: 'progress-bar',
    attrs: {
      role: 'progressbar',
      'aria-valuenow': String(pct),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': `Question completion: ${pct}%`,
    },
  });

  // Approved fill (behind answered, striped pattern for non-colour distinction)
  if (bid.approved_questions > 0) {
    const approvedFill = createElement('div', {
      className: 'progress-bar-approved',
    });
    approvedFill.style.width =
      bid.total_questions > 0
        ? `${(bid.approved_questions / bid.total_questions) * 100}%`
        : '0%';
    bar.appendChild(approvedFill);
  }

  // Answered fill (on top, partial opacity where it overlaps approved)
  const answeredFill = createElement('div', {
    className: 'progress-bar-fill',
  });
  answeredFill.style.width =
    bid.total_questions > 0
      ? `${(bid.answered_questions / bid.total_questions) * 100}%`
      : '0%';
  bar.appendChild(answeredFill);

  section.appendChild(bar);

  return section;
}

function buildDetailSection(state: ExpandedBidState): HTMLElement {
  const section = createElement('div', { className: 'bid-detail' });

  if (state.loading) {
    const loading = createElement('div', {
      className: 'bid-detail-loading',
      attrs: { role: 'status' },
    });
    loading.textContent = 'Loading bid detail\u2026';
    section.appendChild(loading);
    return section;
  }

  if (state.error) {
    const error = createElement('div', { className: 'bid-detail-error' });
    error.textContent = state.error;
    section.appendChild(error);
    return section;
  }

  if (!state.detail) {
    const empty = createElement('div', { className: 'bid-detail-loading' });
    empty.textContent = 'No detail available.';
    section.appendChild(empty);
    return section;
  }

  const detail = state.detail;

  // "View in Knowledge Hub" link
  const viewLink = createElement('button', {
    className: 'view-in-kb-btn',
    attrs: {
      type: 'button',
      'aria-label': `Open ${detail.name} in Knowledge Hub`,
    },
  });
  viewLink.textContent = 'View in Knowledge Hub \u2192';
  viewLink.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    app
      .sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Show me the full detail for the ${detail.name} bid.`,
          },
        ],
      })
      .catch(() => {
        // Silently handle — user can ask Claude manually
      });
  });
  section.appendChild(viewLink);

  // Metadata
  const meta = createElement('div', { className: 'bid-detail-meta' });
  if (detail.reference_number) {
    const ref = createElement('p');
    ref.textContent = `Reference: ${detail.reference_number}`;
    meta.appendChild(ref);
  }
  if (detail.description) {
    const desc = createElement('p');
    desc.textContent =
      detail.description.length > 200
        ? detail.description.slice(0, 197) + '\u2026'
        : detail.description;
    meta.appendChild(desc);
  }
  if (meta.childNodes.length > 0) {
    section.appendChild(meta);
  }

  // Breakdown bars (status + confidence)
  if (
    detail.status_breakdown &&
    Object.keys(detail.status_breakdown).length > 0
  ) {
    section.appendChild(
      buildBreakdownSection('Status', detail.status_breakdown, 'status'),
    );
  }
  if (
    detail.confidence_breakdown &&
    Object.keys(detail.confidence_breakdown).length > 0
  ) {
    section.appendChild(
      buildBreakdownSection(
        'Confidence',
        detail.confidence_breakdown,
        'confidence',
      ),
    );
  }

  // Question stats (legacy grid, kept for backward compatibility)
  if (detail.question_stats) {
    const qs = detail.question_stats;
    const statsTitle = createElement('div', {
      className: 'bid-detail-section-title',
    });
    statsTitle.textContent = 'Question Breakdown';
    section.appendChild(statsTitle);

    const stats = createElement('div', { className: 'question-stats' });

    const statItems: Array<{
      label: string;
      value: number;
      modifier?: string;
    }> = [
      { label: 'Total', value: qs.total_questions },
      {
        label: 'Strong Match',
        value: qs.strong_match_count,
        modifier: 'strong',
      },
      {
        label: 'Partial Match',
        value: qs.partial_match_count,
        modifier: 'partial',
      },
      { label: 'Needs SME', value: qs.needs_sme_count, modifier: 'weak' },
      { label: 'No Content', value: qs.no_content_count, modifier: 'none' },
      { label: 'Drafted', value: qs.drafted_count },
      { label: 'Complete', value: qs.complete_count, modifier: 'strong' },
    ];

    for (const item of statItems) {
      const el = createElement('div', {
        className: item.modifier
          ? `stat-item stat-item--${item.modifier}`
          : 'stat-item',
      });
      const label = createElement('div', { className: 'stat-item-label' });
      label.textContent = item.label;
      const value = createElement('div', { className: 'stat-item-value' });
      value.textContent = String(item.value);
      el.appendChild(label);
      el.appendChild(value);
      stats.appendChild(el);
    }

    section.appendChild(stats);
  }

  // Question list grouped by section
  section.appendChild(buildQuestionList(detail, state));

  return section;
}

// -- Breakdown bar -----------------------------------------------------------

function buildBreakdownSection(
  title: string,
  breakdown: Record<string, number>,
  type: 'status' | 'confidence',
): HTMLElement {
  const container = createElement('div', { className: 'breakdown-container' });

  const label = createElement('div', { className: 'bid-detail-section-title' });
  label.textContent = `${title} Breakdown`;
  container.appendChild(label);

  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  if (total === 0) return container;

  const bar = createElement('div', {
    className: 'breakdown-bar',
    attrs: {
      role: 'img',
      'aria-label': `${title} breakdown: ${Object.entries(breakdown)
        .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
        .join(', ')}`,
    },
  });

  for (const [key, count] of Object.entries(breakdown)) {
    if (count === 0) continue;
    const pct = (count / total) * 100;
    const segment = createElement('div', {
      className: `breakdown-segment breakdown-segment--${type}-${key.replace(/_/g, '-')}`,
    });
    segment.style.width = `${pct}%`;

    // Text label inside segment for accessibility (not colour alone)
    const segLabel = createElement('span', {
      className: 'breakdown-segment-label',
    });
    segLabel.textContent = `${key.replace(/_/g, ' ')} (${count})`;
    segment.appendChild(segLabel);

    bar.appendChild(segment);
  }

  container.appendChild(bar);

  // Legend below bar
  const legend = createElement('div', { className: 'breakdown-legend' });
  for (const [key, count] of Object.entries(breakdown)) {
    if (count === 0) continue;
    const item = createElement('span', { className: 'breakdown-legend-item' });
    const swatch = createElement('span', {
      className: `breakdown-swatch breakdown-swatch--${type}-${key.replace(/_/g, '-')}`,
      attrs: { 'aria-hidden': 'true' },
    });
    item.appendChild(swatch);
    item.appendChild(
      document.createTextNode(`${key.replace(/_/g, ' ')} (${count})`),
    );
    legend.appendChild(item);
  }
  container.appendChild(legend);

  return container;
}

// -- Question list -----------------------------------------------------------

function buildQuestionList(
  detail: BidDetailData,
  state: ExpandedBidState,
): HTMLElement {
  const container = createElement('div', { className: 'question-sections' });

  if (!detail.sections || detail.sections.length === 0) {
    const empty = createElement('p', { className: 'question-sections-empty' });
    empty.textContent = 'No questions loaded.';
    container.appendChild(empty);
    return container;
  }

  const sectionTitle = createElement('div', {
    className: 'bid-detail-section-title',
  });
  sectionTitle.textContent = 'Questions by Section';
  container.appendChild(sectionTitle);

  for (const section of detail.sections) {
    const sectionEl = createElement('div', { className: 'question-section' });

    // Section header
    const header = createElement('div', {
      className: 'question-section-header',
    });
    header.textContent = `${section.name} (${section.questions.length})`;
    sectionEl.appendChild(header);

    // Question rows
    for (const q of section.questions) {
      sectionEl.appendChild(buildQuestionRow(q, state));
    }

    container.appendChild(sectionEl);
  }

  return container;
}

// -- Question row ------------------------------------------------------------

function buildQuestionRow(
  q: BidQuestionSummary,
  state: ExpandedBidState,
): HTMLElement {
  const isExpanded = state.expandedQuestion?.questionId === q.id;

  const row = createElement('div', {
    className: `question-row${isExpanded ? ' question-row--expanded' : ''}`,
    attrs: {
      role: 'button',
      tabindex: '0',
      'aria-expanded': String(isExpanded),
      'data-question-id': q.id,
    },
  });

  // Status indicator
  const statusEl = createElement('span', {
    className: `question-status question-status--${(q.status ?? 'not_started').replace(/_/g, '-')}`,
    attrs: {
      'aria-label': `Status: ${(q.status ?? 'not started').replace(/_/g, ' ')}`,
    },
  });
  // Use different symbols for different statuses (not colour alone)
  const statusSymbol = getStatusSymbol(q.status);
  statusEl.textContent = statusSymbol;
  row.appendChild(statusEl);

  // Question text (truncated)
  const textEl = createElement('span', { className: 'question-text' });
  textEl.textContent =
    q.question_text.length > 80
      ? q.question_text.slice(0, 77) + '...'
      : q.question_text;
  row.appendChild(textEl);

  // Confidence badge
  if (q.confidence_posture) {
    row.appendChild(buildConfidenceBadge(q.confidence_posture));
  }

  // Click handler
  row.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    toggleQuestionExpansion(q.id);
  });
  row.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      e.stopPropagation();
      toggleQuestionExpansion(q.id);
    }
  });

  // Expanded detail
  if (isExpanded && state.expandedQuestion) {
    row.appendChild(buildQuestionDetail(state.expandedQuestion));
  }

  return row;
}

function getStatusSymbol(status: string | null): string {
  switch (status) {
    case 'complete':
      return '\u2713'; // check mark
    case 'ai_drafted':
      return '\u270E'; // pencil
    case 'not_started':
    default:
      return '\u25CB'; // circle
  }
}

// -- Confidence badge --------------------------------------------------------

function buildConfidenceBadge(posture: string): HTMLElement {
  const validPostures = [
    'strong_match',
    'partial_match',
    'needs_sme',
    'no_content',
  ];
  const modifier = validPostures.includes(posture)
    ? posture.replace(/_/g, '-')
    : 'unmatched';
  const badge = createElement('span', {
    className: `confidence-badge confidence-badge--${modifier}`,
  });
  badge.textContent = posture.replace(/_/g, ' ');
  return badge;
}

// -- Question expansion ------------------------------------------------------

async function toggleQuestionExpansion(questionId: string): Promise<void> {
  if (!expandedBid) return;

  // Collapse if already expanded
  if (expandedBid.expandedQuestion?.questionId === questionId) {
    expandedBid = { ...expandedBid, expandedQuestion: null };
    renderDashboard();
    return;
  }

  // Start loading
  expandedBid = {
    ...expandedBid,
    expandedQuestion: {
      questionId,
      loading: true,
      detail: null,
      kbResults: null,
      kbSearchLoading: false,
    },
  };
  renderDashboard();

  try {
    const result = await app.callServerTool({
      name: 'get_bid_question',
      arguments: { question_id: questionId },
    });

    const detail = result.structuredContent as unknown as BidQuestionDetailData;
    expandedBid = {
      ...expandedBid!,
      expandedQuestion: {
        questionId,
        loading: false,
        detail: detail?.id ? detail : null,
        kbResults: null,
        kbSearchLoading: false,
      },
    };
  } catch (err) {
    expandedBid = {
      ...expandedBid!,
      expandedQuestion: {
        questionId,
        loading: false,
        detail: null,
        kbResults: null,
        kbSearchLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load question',
      },
    };
  }

  renderDashboard();
}

// -- Question detail panel ---------------------------------------------------

function buildQuestionDetail(state: ExpandedQuestionState): HTMLElement {
  const panel = createElement('div', { className: 'question-detail-panel' });

  if (state.loading) {
    const loading = createElement('div', {
      className: 'question-detail-loading',
      attrs: { role: 'status' },
    });
    loading.textContent = 'Loading question detail\u2026';
    panel.appendChild(loading);
    return panel;
  }

  if (state.error) {
    const error = createElement('div', { className: 'question-detail-error' });
    error.textContent = state.error;
    panel.appendChild(error);
    return panel;
  }

  if (!state.detail) return panel;

  const detail = state.detail;

  // Full question text
  const questionText = createElement('p', {
    className: 'question-detail-text',
  });
  questionText.textContent = detail.question_text;
  panel.appendChild(questionText);

  // Metadata row
  const metaRow = createElement('div', { className: 'question-detail-meta' });
  if (detail.word_limit) {
    const wl = createElement('span', { className: 'question-meta-tag' });
    wl.textContent = `Word limit: ${detail.word_limit}`;
    metaRow.appendChild(wl);
  }
  if (detail.review_status) {
    const rs = createElement('span', { className: 'question-meta-tag' });
    rs.textContent = `Review: ${detail.review_status.replace(/_/g, ' ')}`;
    metaRow.appendChild(rs);
  }
  if (detail.confidence_posture) {
    metaRow.appendChild(buildConfidenceBadge(detail.confidence_posture));
  }
  if (metaRow.childNodes.length > 0) panel.appendChild(metaRow);

  // Response preview
  if (detail.response_text) {
    const responseSection = createElement('div', {
      className: 'question-response-preview',
    });
    const responseLabel = createElement('div', {
      className: 'question-response-label',
    });
    responseLabel.textContent = 'Response Preview';
    responseSection.appendChild(responseLabel);
    const responseText = createElement('p', {
      className: 'question-response-text',
    });
    responseText.textContent =
      detail.response_text.length > 300
        ? detail.response_text.slice(0, 297) + '...'
        : detail.response_text;
    responseSection.appendChild(responseText);
    panel.appendChild(responseSection);
  }

  // "Find KB Content" button
  const findBtn = createElement('button', {
    className: 'find-kb-btn',
    attrs: {
      type: 'button',
      'aria-label': 'Search knowledge base for relevant content',
    },
  });
  findBtn.textContent = 'Find KB Content';
  findBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    searchKBForQuestion(state.questionId, detail.question_text);
  });
  panel.appendChild(findBtn);

  // KB search results (if loaded)
  if (state.kbSearchLoading) {
    const loading = createElement('div', {
      className: 'kb-results-loading',
      attrs: { role: 'status' },
    });
    loading.textContent = 'Searching knowledge base\u2026';
    panel.appendChild(loading);
  } else if (state.kbResults && state.kbResults.length > 0) {
    panel.appendChild(buildKBResultsList(state.kbResults));
  } else if (state.kbResults && state.kbResults.length === 0) {
    const empty = createElement('p', { className: 'kb-results-empty' });
    empty.textContent = 'No matching KB content found.';
    panel.appendChild(empty);
  }

  return panel;
}

// -- KB search ---------------------------------------------------------------

async function searchKBForQuestion(
  questionId: string,
  questionText: string,
): Promise<void> {
  if (!expandedBid?.expandedQuestion) return;

  expandedBid = {
    ...expandedBid,
    expandedQuestion: {
      ...expandedBid.expandedQuestion,
      kbSearchLoading: true,
      kbResults: null,
    },
  };
  renderDashboard();

  try {
    const result = await app.callServerTool({
      name: 'search_knowledge_base',
      arguments: { query: questionText, limit: 5 },
    });

    const data = result.structuredContent as unknown as {
      results?: KBSearchResult[];
    };
    expandedBid = {
      ...expandedBid!,
      expandedQuestion: {
        ...expandedBid!.expandedQuestion!,
        kbSearchLoading: false,
        kbResults: data?.results ?? [],
      },
    };
  } catch {
    expandedBid = {
      ...expandedBid!,
      expandedQuestion: {
        ...expandedBid!.expandedQuestion!,
        kbSearchLoading: false,
        kbResults: [],
      },
    };
  }

  renderDashboard();
}

// -- KB results list ---------------------------------------------------------

function buildKBResultsList(results: KBSearchResult[]): HTMLElement {
  const container = createElement('div', { className: 'kb-results' });
  const header = createElement('div', { className: 'kb-results-header' });
  header.textContent = `${results.length} matching KB item${results.length !== 1 ? 's' : ''}`;
  container.appendChild(header);

  for (const item of results) {
    const row = createElement('div', { className: 'kb-result-row' });
    const title = createElement('div', { className: 'kb-result-title' });
    title.textContent = item.suggested_title ?? item.title ?? 'Untitled';
    row.appendChild(title);

    const meta = createElement('div', { className: 'kb-result-meta' });
    if (item.content_type) {
      const type = createElement('span', { className: 'kb-result-type' });
      type.textContent = item.content_type.replace(/_/g, ' ');
      meta.appendChild(type);
    }
    if (item.primary_domain) {
      const domain = createElement('span', { className: 'kb-result-domain' });
      domain.textContent = item.primary_domain;
      meta.appendChild(domain);
    }
    const similarity = createElement('span', {
      className: 'kb-result-similarity',
    });
    similarity.textContent = `${Math.round(item.similarity * 100)}% match`;
    meta.appendChild(similarity);
    row.appendChild(meta);

    if (item.summary) {
      const summary = createElement('p', { className: 'kb-result-summary' });
      summary.textContent =
        item.summary.length > 150
          ? item.summary.slice(0, 147) + '...'
          : item.summary;
      row.appendChild(summary);
    }

    container.appendChild(row);
  }

  return container;
}

// -- Bid expansion -----------------------------------------------------------

async function toggleBidExpansion(bidId: string): Promise<void> {
  // Collapse if already expanded
  if (expandedBid?.bidId === bidId) {
    expandedBid = null;
    renderDashboard();
    return;
  }

  // Start loading
  expandedBid = { bidId, loading: true, detail: null, expandedQuestion: null };
  renderDashboard();

  try {
    const result = await app.callServerTool({
      name: 'get_bid_detail',
      arguments: { id: bidId },
    });

    const detail = result.structuredContent as unknown as BidDetailData;
    expandedBid = {
      bidId,
      loading: false,
      detail: detail?.id ? detail : null,
      expandedQuestion: null,
    };
  } catch (err) {
    expandedBid = {
      bidId,
      loading: false,
      detail: null,
      error: err instanceof Error ? err.message : 'Failed to load bid detail',
      expandedQuestion: null,
    };
  }

  renderDashboard();
}

// -- Urgency helpers ---------------------------------------------------------

function getUrgency(daysUntil: number | null): Urgency {
  if (daysUntil === null) return 'none';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 3) return 'urgent';
  if (daysUntil <= 14) return 'approaching';
  return 'normal';
}

function getUrgencyOrder(bid: BidSummary): number {
  const urgency = getUrgency(bid.days_until_deadline);
  const order: Record<Urgency, number> = {
    overdue: 0,
    urgent: 1,
    approaching: 2,
    normal: 3,
    none: 4,
  };
  // Within the same urgency, sort by days (ascending)
  return order[urgency] * 10000 + (bid.days_until_deadline ?? 9999);
}

function buildCardClassName(urgency: Urgency, isExpanded: boolean): string {
  const classes = ['bid-card'];
  if (
    urgency === 'overdue' ||
    urgency === 'urgent' ||
    urgency === 'approaching'
  ) {
    classes.push(`bid-card--${urgency}`);
  }
  if (isExpanded) {
    classes.push('bid-card--expanded');
  }
  return classes.join(' ');
}

// -- Date/deadline formatting ------------------------------------------------

function formatDateUK(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

function formatDeadlineText(
  deadline: string | null,
  daysUntil: number | null,
): string {
  if (!deadline) return 'No deadline';
  if (daysUntil === null) return formatDateUK(deadline);
  if (daysUntil < 0) {
    return `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue`;
  }
  if (daysUntil === 0) return 'Due today';
  return `${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;
}

function formatDeadlineAriaLabel(
  deadline: string | null,
  daysUntil: number | null,
): string {
  if (!deadline) return 'No deadline set';
  const dateStr = formatDateUK(deadline);
  if (daysUntil === null) return `Deadline: ${dateStr}`;
  if (daysUntil < 0) {
    return `Deadline: ${dateStr}, ${Math.abs(daysUntil)} days overdue`;
  }
  if (daysUntil === 0) return `Deadline: ${dateStr}, due today`;
  return `Deadline: ${dateStr}, ${daysUntil} days remaining`;
}

// -- DOM utilities -----------------------------------------------------------

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
