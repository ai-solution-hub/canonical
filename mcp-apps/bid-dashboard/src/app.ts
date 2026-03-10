import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type {
  BidDashboardData,
  BidSummary,
  BidDetailData,
  Urgency,
  ExpandedBidState,
} from "./types";
import "./styles.css";

// -- App setup ---------------------------------------------------------------

const app = new App({ name: "Bid Dashboard", version: "1.0.0" });

const root = document.getElementById("app")!;
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
        (c: { type: string }) => c.type === "text"
      ) as { text?: string } | undefined;
      renderEmpty(text?.text ?? "No bid data available.");
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
      };
    }

    renderDashboard();
  } catch {
    renderEmpty("Failed to parse bid data.");
  }
};

app.ontoolinput = () => {
  renderLoading();
};

app.ontoolcancelled = () => {
  renderEmpty("Bid dashboard request was cancelled.");
};

app.onerror = (error) => {
  renderEmpty(`Connection error: ${error?.message ?? "Unknown error"}`);
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
  const container = createElement("div", {
    className: "loading-state",
    attrs: { role: "status", "aria-label": "Loading bid data" },
  });
  const spinner = createElement("div", {
    className: "loading-spinner",
    attrs: { "aria-hidden": "true" },
  });
  const text = createElement("p");
  text.textContent = "Waiting for bid data\u2026";
  container.appendChild(spinner);
  container.appendChild(text);
  root.appendChild(container);
}

function renderEmpty(message: string): void {
  clearElement(root);
  const container = createElement("div", {
    className: "empty-state",
    attrs: { role: "status" },
  });
  const icon = createElement("div", {
    className: "empty-state-icon",
    attrs: { "aria-hidden": "true" },
  });
  icon.textContent = "\u{1F4CB}";
  const text = createElement("p");
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
  const header = createElement("header", { className: "dashboard-header" });
  const title = createElement("h1", { className: "dashboard-title" });
  title.textContent = "Bid Dashboard";
  const subtitle = createElement("p", { className: "dashboard-subtitle" });
  subtitle.textContent = "Active bids with progress and deadline tracking";
  header.appendChild(title);
  header.appendChild(subtitle);
  root.appendChild(header);

  // Summary bar
  root.appendChild(buildSummaryBar(sortedBids, total_count));

  // Bid cards
  if (sortedBids.length === 0) {
    const empty = createElement("div", {
      className: "empty-state",
      attrs: { role: "status" },
    });
    const p = createElement("p");
    p.textContent = "No active bids found.";
    empty.appendChild(p);
    root.appendChild(empty);
  } else {
    const list = createElement("div", {
      className: "bid-list",
      attrs: { role: "list", "aria-label": "Active bids" },
    });
    for (const bid of sortedBids) {
      list.appendChild(buildBidCard(bid));
    }
    root.appendChild(list);
  }
}

function buildSummaryBar(bids: BidSummary[], totalCount: number): HTMLElement {
  const bar = createElement("div", {
    className: "summary-bar",
    attrs: { role: "region", "aria-label": "Bid pipeline summary" },
  });

  const overdueCount = bids.filter(
    (b) => b.days_until_deadline !== null && b.days_until_deadline < 0
  ).length;
  const totalQuestions = bids.reduce((sum, b) => sum + b.total_questions, 0);
  const totalAnswered = bids.reduce((sum, b) => sum + b.answered_questions, 0);

  const cards: Array<{
    label: string;
    value: string;
    modifier?: string;
  }> = [
    { label: "Total Bids", value: String(totalCount) },
    { label: "Overdue", value: String(overdueCount), modifier: overdueCount > 0 ? "overdue" : undefined },
    {
      label: "Questions",
      value: totalQuestions > 0
        ? `${totalAnswered}/${totalQuestions}`
        : "0",
    },
    {
      label: "Completion",
      value: totalQuestions > 0
        ? `${Math.round((totalAnswered / totalQuestions) * 100)}%`
        : "0%",
    },
  ];

  for (const card of cards) {
    const cardEl = createElement("div", {
      className: card.modifier
        ? `summary-card summary-card--${card.modifier}`
        : "summary-card",
    });
    const labelEl = createElement("div", { className: "summary-card-label" });
    labelEl.textContent = card.label;
    const valueEl = createElement("div", { className: "summary-card-value" });
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

  const card = createElement("div", {
    className: buildCardClassName(urgency, isExpanded),
    attrs: {
      role: "button",
      tabindex: "0",
      "aria-expanded": String(isExpanded),
      "aria-label": `${bid.name}${bid.buyer ? `, ${bid.buyer}` : ""} — ${bid.status}`,
      "data-bid-id": bid.id,
    },
  });

  // Header row
  const headerRow = createElement("div", { className: "bid-card-header" });

  // Left side: name + buyer
  const left = createElement("div", { className: "bid-card-left" });
  const name = createElement("div", { className: "bid-card-name" });

  const chevron = createElement("span", {
    className: `bid-card-chevron${isExpanded ? " bid-card-chevron--expanded" : ""}`,
    attrs: { "aria-hidden": "true" },
  });
  chevron.textContent = "\u25B6";
  name.appendChild(chevron);
  name.appendChild(document.createTextNode(` ${bid.name}`));
  left.appendChild(name);

  if (bid.buyer) {
    const buyer = createElement("div", { className: "bid-card-buyer" });
    buyer.textContent = bid.buyer;
    left.appendChild(buyer);
  }

  headerRow.appendChild(left);

  // Right side: status + deadline badges
  const right = createElement("div", { className: "bid-card-right" });
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
  card.addEventListener("click", toggleHandler);
  card.addEventListener("keydown", (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" || ke.key === " ") {
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
  const validStatuses = ["draft", "active", "submitted", "won", "lost"];
  const modifier = validStatuses.includes(status) ? status : "draft";
  const badge = createElement("span", {
    className: `status-badge status-badge--${modifier}`,
  });
  badge.textContent = status;
  return badge;
}

function buildDeadlineBadge(
  deadline: string | null,
  daysUntil: number | null
): HTMLElement {
  const urgency = getUrgency(daysUntil);

  const badge = createElement("span", {
    className: `deadline-badge deadline-badge--${urgency}`,
    attrs: {
      "aria-label": formatDeadlineAriaLabel(deadline, daysUntil),
    },
  });

  badge.textContent = formatDeadlineText(deadline, daysUntil);
  return badge;
}

function buildProgressSection(bid: BidSummary): HTMLElement {
  const section = createElement("div", { className: "bid-card-progress" });

  const labels = createElement("div", { className: "progress-labels" });

  const answered = createElement("span", { className: "progress-answered" });
  const pct =
    bid.total_questions > 0
      ? Math.round((bid.answered_questions / bid.total_questions) * 100)
      : 0;
  answered.textContent = `${bid.answered_questions}/${bid.total_questions} answered (${pct}%)`;
  labels.appendChild(answered);

  if (bid.approved_questions > 0) {
    const approved = createElement("span", { className: "progress-approved" });
    approved.textContent = `${bid.approved_questions} approved`;
    labels.appendChild(approved);
  }

  section.appendChild(labels);

  // Progress bar with stacked layers
  const bar = createElement("div", {
    className: "progress-bar",
    attrs: {
      role: "progressbar",
      "aria-valuenow": String(pct),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-label": `Question completion: ${pct}%`,
    },
  });

  // Approved fill (behind answered, striped pattern for non-colour distinction)
  if (bid.approved_questions > 0) {
    const approvedFill = createElement("div", {
      className: "progress-bar-approved",
    });
    approvedFill.style.width =
      bid.total_questions > 0
        ? `${(bid.approved_questions / bid.total_questions) * 100}%`
        : "0%";
    bar.appendChild(approvedFill);
  }

  // Answered fill (on top, partial opacity where it overlaps approved)
  const answeredFill = createElement("div", {
    className: "progress-bar-fill",
  });
  answeredFill.style.width =
    bid.total_questions > 0
      ? `${(bid.answered_questions / bid.total_questions) * 100}%`
      : "0%";
  bar.appendChild(answeredFill);

  section.appendChild(bar);

  return section;
}

function buildDetailSection(state: ExpandedBidState): HTMLElement {
  const section = createElement("div", { className: "bid-detail" });

  if (state.loading) {
    const loading = createElement("div", {
      className: "bid-detail-loading",
      attrs: { role: "status" },
    });
    loading.textContent = "Loading bid detail\u2026";
    section.appendChild(loading);
    return section;
  }

  if (state.error) {
    const error = createElement("div", { className: "bid-detail-error" });
    error.textContent = state.error;
    section.appendChild(error);
    return section;
  }

  if (!state.detail) {
    const empty = createElement("div", { className: "bid-detail-loading" });
    empty.textContent = "No detail available.";
    section.appendChild(empty);
    return section;
  }

  const detail = state.detail;

  // "View in Knowledge Hub" link
  const viewLink = createElement("button", {
    className: "view-in-kb-btn",
    attrs: {
      type: "button",
      "aria-label": `Open ${detail.name} in Knowledge Hub`,
    },
  });
  viewLink.textContent = "View in Knowledge Hub \u2192";
  viewLink.addEventListener("click", (e: Event) => {
    e.stopPropagation();
    app.openUrl(`/bid/${detail.id}`);
  });
  section.appendChild(viewLink);

  // Metadata
  const meta = createElement("div", { className: "bid-detail-meta" });
  if (detail.reference_number) {
    const ref = createElement("p");
    ref.textContent = `Reference: ${detail.reference_number}`;
    meta.appendChild(ref);
  }
  if (detail.description) {
    const desc = createElement("p");
    desc.textContent =
      detail.description.length > 200
        ? detail.description.slice(0, 197) + "\u2026"
        : detail.description;
    meta.appendChild(desc);
  }
  if (meta.childNodes.length > 0) {
    section.appendChild(meta);
  }

  // Question stats
  if (detail.question_stats) {
    const qs = detail.question_stats;
    const statsTitle = createElement("div", {
      className: "bid-detail-section-title",
    });
    statsTitle.textContent = "Question Breakdown";
    section.appendChild(statsTitle);

    const stats = createElement("div", { className: "question-stats" });

    const statItems: Array<{
      label: string;
      value: number;
      modifier?: string;
    }> = [
      { label: "Total", value: qs.total_questions },
      { label: "Strong Match", value: qs.strong_match_count, modifier: "strong" },
      { label: "Partial Match", value: qs.partial_match_count, modifier: "partial" },
      { label: "Needs SME", value: qs.needs_sme_count, modifier: "weak" },
      { label: "No Content", value: qs.no_content_count, modifier: "none" },
      { label: "Drafted", value: qs.drafted_count },
      { label: "Complete", value: qs.complete_count, modifier: "strong" },
    ];

    for (const item of statItems) {
      const el = createElement("div", {
        className: item.modifier
          ? `stat-item stat-item--${item.modifier}`
          : "stat-item",
      });
      const label = createElement("div", { className: "stat-item-label" });
      label.textContent = item.label;
      const value = createElement("div", { className: "stat-item-value" });
      value.textContent = String(item.value);
      el.appendChild(label);
      el.appendChild(value);
      stats.appendChild(el);
    }

    section.appendChild(stats);
  }

  return section;
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
  expandedBid = { bidId, loading: true, detail: null };
  renderDashboard();

  try {
    const result = await app.callServerTool({
      name: "get_bid_detail",
      arguments: { id: bidId },
    });

    const detail = result.structuredContent as unknown as BidDetailData;
    expandedBid = {
      bidId,
      loading: false,
      detail: detail?.id ? detail : null,
    };
  } catch (err) {
    expandedBid = {
      bidId,
      loading: false,
      detail: null,
      error: err instanceof Error ? err.message : "Failed to load bid detail",
    };
  }

  renderDashboard();
}

// -- Urgency helpers ---------------------------------------------------------

function getUrgency(daysUntil: number | null): Urgency {
  if (daysUntil === null) return "none";
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 3) return "urgent";
  if (daysUntil <= 14) return "approaching";
  return "normal";
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
  const classes = ["bid-card"];
  if (urgency === "overdue" || urgency === "urgent" || urgency === "approaching") {
    classes.push(`bid-card--${urgency}`);
  }
  if (isExpanded) {
    classes.push("bid-card--expanded");
  }
  return classes.join(" ");
}

// -- Date/deadline formatting ------------------------------------------------

function formatDateUK(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

function formatDeadlineText(
  deadline: string | null,
  daysUntil: number | null
): string {
  if (!deadline) return "No deadline";
  if (daysUntil === null) return formatDateUK(deadline);
  if (daysUntil < 0) {
    return `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? "s" : ""} overdue`;
  }
  if (daysUntil === 0) return "Due today";
  return `${daysUntil} day${daysUntil !== 1 ? "s" : ""}`;
}

function formatDeadlineAriaLabel(
  deadline: string | null,
  daysUntil: number | null
): string {
  if (!deadline) return "No deadline set";
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
  options?: CreateElementOptions
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
