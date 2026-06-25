import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type {
  ReorientAppData,
  UrgentItem,
  TeamChange,
  RecentWorkItem,
  ProcurementBriefing,
} from './types';
import './styles.css';

// Configure marked: no async renderer, safe defaults
marked.setOptions({ async: false });

const app = new App({ name: 'Reorient Me', version: '1.0.0' });
const root = document.getElementById('app')!;

let briefingData: ReorientAppData | null = null;
let detailPanel: {
  title: string;
  loading: boolean;
  content: string | null;
  error?: string;
} | null = null;

// Initial render
renderLoading();

// Host context handler
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

// App event handlers
app.ontoolresult = (result) => {
  if (result.isError) {
    const text = result.content?.find((c) => c.type === 'text') as
      | { text: string }
      | undefined;
    renderEmpty(`Error: ${text?.text ?? 'Unknown error'}`);
    return;
  }

  // Expect structuredContent mapped to ReorientAppData
  const data = result.structuredContent as unknown as ReorientAppData;
  if (!data || !Array.isArray(data.urgent)) {
    renderEmpty('Invalid data format received.');
    return;
  }

  briefingData = data;
  detailPanel = null;
  renderBriefing();
};

app.ontoolinput = () => {
  renderLoading();
};

app.ontoolcancelled = () => {
  renderEmpty('Briefing request was cancelled.');
};

app.onerror = (error) => {
  renderEmpty(`Error: ${error?.message ?? 'Unknown error'}`);
};

app.onhostcontextchanged = handleHostContextChanged;

app.onteardown = async () => {
  briefingData = null;
  detailPanel = null;
  root.innerHTML = '';
  return {};
};

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function askClaude(prompt: string, statusEl: HTMLElement): Promise<void> {
  statusEl.textContent = 'Asking Claude...';
  statusEl.className = 'action-status action-status--loading';
  statusEl.setAttribute('role', 'status');

  try {
    await app.sendMessage({
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    });
    statusEl.textContent = 'Message sent to Claude.';
    statusEl.className = 'action-status action-status--success';
  } catch {
    statusEl.textContent =
      'Could not send message. Try asking Claude directly.';
    statusEl.className = 'action-status action-status--error';
  }
}

async function drillDown(
  toolName: string,
  args: Record<string, unknown>,
  title: string,
): Promise<void> {
  detailPanel = { title, loading: true, content: null };
  renderDetailPanel();

  try {
    const result = await app.callServerTool({
      name: toolName,
      arguments: args,
    });
    const text = result.content?.find((c) => c.type === 'text') as
      | { text?: string }
      | undefined;

    // We only update if this panel is still active (prevents race conditions if clicked twice)
    if (detailPanel && detailPanel.title === title) {
      detailPanel = {
        title,
        loading: false,
        content: text?.text ?? 'No detail available.',
      };
      renderDetailPanel();
    }
  } catch (err) {
    if (detailPanel && detailPanel.title === title) {
      detailPanel = {
        title,
        loading: false,
        content: null,
        error: err instanceof Error ? err.message : 'Failed to load detail',
      };
      renderDetailPanel();
    }
  }
}

function handleCloseDetailPanel() {
  detailPanel = null;
  renderDetailPanel();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && detailPanel) {
    handleCloseDetailPanel();
  }
});

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderLoading() {
  root.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Waiting for briefing data...</p>
    </div>
  `;
}

function renderEmpty(message: string) {
  root.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🧭</div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderBriefing() {
  if (!briefingData) return;

  const { urgent, team_changes, my_recent_work, bid_summary } = briefingData;

  const isEmpty =
    urgent.length === 0 &&
    team_changes.length === 0 &&
    my_recent_work.length === 0 &&
    bid_summary.length === 0;

  if (isEmpty && !briefingData.last_active_at) {
    renderEmpty(
      "Welcome to Knowledge Hub. Let's get your company knowledge organised.",
    );
    return;
  } else if (isEmpty) {
    renderEmpty(
      'Everything looks good — no urgent items and nothing new since your last visit.',
    );
    return;
  }

  root.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'briefing-container';

  container.appendChild(buildWelcomeHeader(briefingData));

  if (urgent.length > 0) container.appendChild(buildUrgentSection(urgent));
  if (team_changes.length > 0)
    container.appendChild(buildTeamChangesSection(team_changes));
  if (my_recent_work.length > 0)
    container.appendChild(buildRecentWorkSection(my_recent_work));
  if (bid_summary.length > 0)
    container.appendChild(buildBidSummarySection(bid_summary));

  // Placeholder for the detail panel
  const panelDiv = document.createElement('div');
  panelDiv.id = 'detail-panel-container';
  container.appendChild(panelDiv);

  root.appendChild(container);

  // Render detail panel if it already exists (useful for re-renders, not typical)
  renderDetailPanel();
}

function buildWelcomeHeader(data: ReorientAppData): HTMLElement {
  const header = document.createElement('div');
  header.className = 'welcome-header';

  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';

  const name = data.user_display_name ? `, ${data.user_display_name}` : '';
  const lastActive = data.last_active_relative;

  header.innerHTML = `
    <h1 class="welcome-title">🧭 ${escapeHtml(greeting)}${escapeHtml(name)}.</h1>
    <p class="welcome-subtitle">You were last active ${escapeHtml(lastActive)}.</p>
  `;

  return header;
}

function buildUrgentSection(items: UrgentItem[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'briefing-block';
  section.innerHTML = `<h2 class="briefing-block-header">⚠️ Needs Your Attention</h2>`;

  const list = document.createElement('div');
  list.className = 'card-list';
  section.appendChild(list);

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card urgent-card';

    const isOverdue = item.priority === 1;
    const iconClass = isOverdue
      ? 'urgent-icon urgent-icon--overdue'
      : 'urgent-icon';
    const icon =
      item.type === 'procurement_deadline'
        ? isOverdue
          ? '!'
          : '⏰'
        : item.type === 'content_expired'
          ? '↻'
          : item.type === 'review_pending'
            ? '✓'
            : item.type === 'quality_flag'
              ? '🚩'
              : '💬';

    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = `
      <div class="card-title-row">
        <span class="${iconClass}">${icon}</span>
        <span class="card-title">${escapeHtml(item.title)}</span>
      </div>
      <p class="card-detail">${escapeHtml(item.detail)}</p>
    `;

    const actionsRow = document.createElement('div');
    actionsRow.className = 'actions-row';

    const statusEl = document.createElement('div');

    // Action Logic
    if (item.type === 'procurement_deadline') {
      if (isOverdue) {
        // Overdue: Primary = draft answers, Secondary = detail
        const btnDraft = document.createElement('button');
        btnDraft.className = 'btn btn--primary btn--sm';
        btnDraft.textContent = 'Help me draft answers';
        btnDraft.onclick = () =>
          askClaude(
            `Help me draft answers for the unanswered questions in the ${item.title.split('—')[0].trim()} bid. Start with the highest-priority gaps.`,
            statusEl,
          );

        const btnDetail = document.createElement('button');
        btnDetail.className = 'btn btn--sm';
        btnDetail.textContent = 'Show bid detail';
        btnDetail.onclick = () =>
          drillDown(
            'get_procurement_detail',
            { id: item.entity_id },
            item.title,
          );

        actionsRow.appendChild(btnDraft);
        actionsRow.appendChild(btnDetail);
      } else {
        // Urgent: Primary = detail, Secondary = draft answers
        const btnDetail = document.createElement('button');
        btnDetail.className = 'btn btn--sm btn--primary';
        btnDetail.textContent = 'Show bid detail';
        btnDetail.onclick = () =>
          drillDown(
            'get_procurement_detail',
            { id: item.entity_id },
            item.title,
          );

        const btnDraft = document.createElement('button');
        btnDraft.className = 'btn btn--sm';
        btnDraft.textContent = 'Help me draft';
        btnDraft.onclick = () =>
          askClaude(
            `Help me draft answers for the unanswered questions in the ${item.title.split('—')[0].trim()} bid. Start with the highest-priority gaps.`,
            statusEl,
          );

        actionsRow.appendChild(btnDetail);
        actionsRow.appendChild(btnDraft);
      }
    } else if (item.type === 'content_expired') {
      const btn = document.createElement('button');
      btn.className = 'btn btn--sm btn--primary';
      btn.textContent = 'Show freshness report';
      btn.onclick = () =>
        drillDown('where_are_we_exposed', {}, 'Freshness Report');
      actionsRow.appendChild(btn);
    } else if (item.type === 'review_pending') {
      const btn = document.createElement('button');
      btn.className = 'btn btn--sm btn--primary';
      btn.textContent = 'Help me triage reviews';
      btn.onclick = () =>
        askClaude(
          'Show me the items pending governance review and help me triage them.',
          statusEl,
        );
      actionsRow.appendChild(btn);
    } else if (item.type === 'notification') {
      const btn = document.createElement('button');
      btn.className = 'btn btn--sm btn--primary';
      btn.textContent = 'Summarise notifications';
      btn.onclick = () =>
        askClaude(
          'Summarise my unread notifications and suggest which ones need action.',
          statusEl,
        );
      actionsRow.appendChild(btn);
    } else if (item.type === 'quality_flag') {
      const btn = document.createElement('button');
      btn.className = 'btn btn--sm btn--primary';
      btn.textContent = 'Show quality issues';
      btn.onclick = () =>
        drillDown('where_are_we_exposed', {}, 'Quality Summary');
      actionsRow.appendChild(btn);
    }

    actionsRow.appendChild(statusEl);
    card.appendChild(contentDiv);
    card.appendChild(actionsRow);
    list.appendChild(card);
  }

  return section;
}

function buildTeamChangesSection(changes: TeamChange[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'briefing-block';
  section.innerHTML = `<h2 class="briefing-block-header">👥 Since You Were Away</h2>`;

  const list = document.createElement('div');
  list.className = 'compact-list';
  section.appendChild(list);

  // Group by user, action, type
  const grouped = new Map<string, TeamChange[]>();
  for (const c of changes) {
    const key = `${c.user_id}-${c.action}-${c.entity_type}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  }

  for (const group of grouped.values()) {
    const first = group[0];
    const name = first.user_name || 'A team member';
    const itemEl = document.createElement('div');
    itemEl.className = 'compact-list-item';

    // Format: "Sarah updated 3 items in Security"
    // "Sarah updated Data Protection Policy"
    const count = group.length;
    const entityLabel =
      first.entity_type === 'bid_response' ? 'response' : 'item';
    const escapedAction = escapeHtml(first.action);
    let titleStr = '';

    if (count > 1) {
      if (first.domain && first.entity_type === 'content_item') {
        titleStr = `${escapeHtml(name)} ${escapedAction} ${count} ${entityLabel}s in ${escapeHtml(first.domain)}`;
      } else if (first.entity_type === 'bid_response') {
        titleStr = `${escapeHtml(name)} ${escapedAction} ${count} ${entityLabel}s in ${escapeHtml(first.entity_title)} bid`;
      } else {
        titleStr = `${escapeHtml(name)} ${escapedAction} ${count} ${entityLabel}s`;
      }
    } else {
      titleStr = `${escapeHtml(name)} ${escapedAction} "${escapeHtml(first.entity_title)}"`;
    }

    itemEl.innerHTML = `<div class="compact-list-item-content"><span class="compact-list-title">${titleStr}</span></div>`;
    const btnContainer = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn btn--sm';

    if (first.entity_type === 'content_item') {
      btn.textContent = 'View item';
      // We only open the first one if grouped
      btn.onclick = () =>
        drillDown('get', { id: first.entity_id }, first.entity_title);
    } else if (first.entity_type === 'bid_response' && first.workspace_id) {
      btn.textContent = 'View bid';
      btn.onclick = () =>
        drillDown(
          'get_procurement_detail',
          { id: first.workspace_id },
          first.entity_title,
        );
    }

    if (
      first.entity_type === 'content_item' ||
      (first.entity_type === 'bid_response' && first.workspace_id)
    ) {
      btnContainer.appendChild(btn);
    }

    itemEl.appendChild(btnContainer);
    list.appendChild(itemEl);
  }

  return section;
}

function buildRecentWorkSection(items: RecentWorkItem[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'briefing-block';
  section.innerHTML = `<h2 class="briefing-block-header">🕰 Pick Up Where You Left Off</h2>`;

  const list = document.createElement('div');
  list.className = 'compact-list';
  section.appendChild(list);

  for (const item of items) {
    const itemEl = document.createElement('div');
    itemEl.className = 'compact-list-item';

    // Format relative date nicely (e.g., from 2026-03-08T09:00:00Z -> "a few minutes ago")
    // Use the API's date formatting for simplicity here, or just show the action.
    const actionStr = escapeHtml(
      item.action.charAt(0).toUpperCase() + item.action.slice(1),
    );

    itemEl.innerHTML = `
      <div class="compact-list-item-content">
        <span class="compact-list-title">${escapeHtml(item.entity_title)}</span>
        <span class="compact-list-meta">${actionStr}</span>
      </div>
    `;

    const btnContainer = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn btn--sm';

    if (item.entity_type === 'content_item') {
      btn.textContent = 'View item';
      btn.onclick = () =>
        drillDown('get', { id: item.entity_id }, item.entity_title);
    } else if (item.entity_type === 'bid_response' && item.workspace_id) {
      btn.textContent = 'View bid';
      btn.onclick = () =>
        drillDown(
          'get_procurement_detail',
          { id: item.workspace_id },
          item.entity_title,
        );
    }

    if (
      item.entity_type === 'content_item' ||
      (item.entity_type === 'bid_response' && item.workspace_id)
    ) {
      btnContainer.appendChild(btn);
    }

    itemEl.appendChild(btnContainer);
    list.appendChild(itemEl);
  }

  return section;
}

function buildBidSummarySection(bids: ProcurementBriefing[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'briefing-block';
  section.innerHTML = `<h2 class="briefing-block-header">💼 Active Bids</h2>`;

  const list = document.createElement('div');
  list.className = 'card-list';
  section.appendChild(list);

  for (const bid of bids) {
    const card = document.createElement('div');
    card.className = 'card bid-card';

    const badgeClass = `badge badge--${bid.urgency}`;
    let urgencyText = bid.urgency;
    if (bid.days_until_deadline !== null) {
      if (bid.days_until_deadline < 0) urgencyText = 'Overdue';
      else if (bid.days_until_deadline === 0) urgencyText = 'Due today';
      else
        urgencyText = `${bid.days_until_deadline} day${bid.days_until_deadline > 1 ? 's' : ''} left`;
    }

    const pct =
      bid.total_questions > 0
        ? Math.round((bid.answered_questions / bid.total_questions) * 100)
        : 0;

    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = `
      <div class="card-title-row" style="justify-content: space-between;">
        <span class="card-title">${escapeHtml(bid.name)}</span>
        <span class="${badgeClass}">${escapeHtml(urgencyText)}</span>
      </div>
      <div class="progress-container">
        <div class="progress-labels">
          <span>${bid.answered_questions}/${bid.total_questions} drafted</span>
          <span>${pct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;

    const actionsRow = document.createElement('div');
    actionsRow.className = 'actions-row';

    const statusEl = document.createElement('div');

    const btnDetail = document.createElement('button');
    btnDetail.className = 'btn btn--sm';
    btnDetail.textContent = 'Show detail';
    btnDetail.onclick = () =>
      drillDown('get_procurement_detail', { id: bid.id }, bid.name);
    actionsRow.appendChild(btnDetail);

    // If there are gaps, add Draft Next Answer
    if (bid.answered_questions < bid.total_questions) {
      const btnDraft = document.createElement('button');
      btnDraft.className = 'btn btn--sm btn--primary';
      btnDraft.textContent = 'Draft next answer';
      btnDraft.onclick = () =>
        askClaude(
          `Help me draft the next unanswered question for the ${bid.name} bid. Look at the questions that need attention and pick the highest priority one.`,
          statusEl,
        );
      actionsRow.appendChild(btnDraft);
    }

    actionsRow.appendChild(statusEl);

    card.appendChild(contentDiv);
    card.appendChild(actionsRow);
    list.appendChild(card);
  }

  return section;
}

function renderDetailPanel() {
  const container = document.getElementById('detail-panel-container');
  if (!container) return;

  if (!detailPanel) {
    container.innerHTML = '';
    return;
  }

  const { title, loading, content, error } = detailPanel;

  let bodyHtml = '';
  if (loading) {
    bodyHtml = `<div class="detail-panel-loading">Loading ${escapeHtml(title)}...</div>`;
  } else if (error) {
    bodyHtml = `<div class="detail-panel-error">${escapeHtml(error)}</div>`;
  } else if (content) {
    const renderedMd = DOMPurify.sanitize(marked.parse(content) as string);
    bodyHtml = `<div class="detail-panel-body detail-panel-body--markdown">${renderedMd}</div>`;
  }

  container.innerHTML = `
    <div class="detail-panel">
      <div class="detail-panel-header">
        <span>${escapeHtml(title)}</span>
        <button class="detail-panel-close" id="btn-close-detail" aria-label="Close detail panel">✕</button>
      </div>
      ${bodyHtml}
    </div>
  `;

  const btnClose = document.getElementById('btn-close-detail');
  if (btnClose) {
    btnClose.onclick = handleCloseDetailPanel;
  }
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
