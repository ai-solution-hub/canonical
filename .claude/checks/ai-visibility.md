# AI Visibility Check

**Purpose:** Enforce the Knowledge Hub AI Visibility Policy on every user-facing
surface. AI is invisible infrastructure, not a visible product feature. Source
of truth: `docs/reference/ai-visibility-policy.md` — this check restates the
rules so PR reviewers don't need to open two files.

**Severity:** error (rules 1, 2, 4) / warning (rule 3 label drift)

## The four rules

1. **AI processing is invisible.** Classification, embedding, entity extraction,
   summarisation, quality, freshness, and dedup are backend. No "AI-powered"
   badges, no pipeline descriptions, no model names, no "AI-generated" labels,
   no `Sparkles` icons.
2. **AI-derived outputs are platform features.** Quality, freshness, summaries,
   and digests are native. Label the output, not the mechanism — "Quality: 78",
   not "AI Quality Score".
3. **Claude bridge actions are honestly labelled.** Buttons that take users TO
   Claude (via `ClaudePromptButton`) are integration touchpoints, not AI
   branding. Action-first labels ("Take action", "Open in Claude"), never "Ask
   Claude" or "AI-powered workspace".
4. **No in-app chat sidebar.** All AI interactions are invisible background
   processing (Rule 1) or route to Claude via `ClaudePromptButton` (Rule 3). The
   CopilotKit sidebar was removed in S109 and must not return.

## Red flags — fail the PR on any of these

### Forbidden icons

- [ ] `Sparkles` from `lucide-react` in any `app/`, `components/`, or
      `mcp-apps/` file — project-wide banned as an AI signifier.

### Forbidden words and phrases (user-visible strings)

- [ ] `"AI-powered"`, `"AI-filtered"`, `"AI-generated"`, `"AI Update"`,
      `"AI is analysing"`, `"AI classified"`, `"training feedback"`,
      `"three-pass AI pipeline"`.
- [ ] `"smart"` / `"intelligent"` as a feature adjective ("smart filter").
      Ordinary English nouns are fine.
- [ ] Model names: `"claude-sonnet"`, `"claude-opus"`, `"gpt-"`,
      `"text-embedding"`, any `AI_SUMMARY_MODEL` value in user copy.
- [ ] `"prompt"` as a noun referring to an LLM instruction. Acceptable: "Copy
      requirement prompt" (user text). Not: "Edit the scoring prompt".
- [ ] Similarity/confidence percentages as first-class UI fields
      (`similarity 87%`, `confidence: 0.92`) — use qualitative labels.
- [ ] Debug vocabulary: `classification`, `reasoning`, `accuracy`, `FP`, `FN`,
      `scoring prompt`, `per-prompt-version`.

### Forbidden patterns

- [ ] **Human-vs-AI provenance toggles or badges.** A state-union with a literal
      `'ai'` / `'machine'` member (e.g. `'human' | 'ai'`), or a `Badge` labelled
      `AI`, `Machine`, `Auto`, or `AI-generated`. Present both human and machine
      content as "content" — no provenance hint.
- [ ] **Chat sidebar reintroduction.** Any import of CopilotKit or an embedded
      chat/drawer/message-thread UI that calls a model client-side.
- [ ] **Admin surfaces exposed to viewers.** New tabs/routes named `Prompts`,
      `Classification`, `Embedding`, `Scoring`, `Models`, `Training` must be
      gated at the UI layer, not just the API.
- [ ] **Non-action-oriented Claude bridge labels.** `"Ask Claude"`,
      `"Chat     with Claude"`, `"AI-powered assistant"`. Use `"Take action"`,
      `"Review"`, `"Open in Claude"`, `"Continue in Claude"` instead.

## How to audit a PR

1. `git diff main -U5` and scan added (`+`) lines only.
2. Grep the diff for each forbidden word/phrase above, for
   `lucide-react.*Sparkles`, and for any new `'ai'` / `'human'` union literal.
3. For any new user-facing string naming an AI-derived output, confirm it labels
   the output (Rule 2), not the mechanism.
4. For any new Claude-bridge button, confirm the label is action-oriented
   (Rule 3) and the button uses `ClaudePromptButton`.
5. When touching `components/item-detail/`, `components/intelligence/`, or
   `components/coverage/`, cross-check against the exemplars below.

## Known good patterns

- `components/intelligence/health-panel.tsx` — operational vocabulary, no AI
  framing.
- `components/intelligence/filter-ratio-chart.tsx` — accessibility-first,
  platform-native labels.
- `components/intelligence/prompt-performance-table.tsx` — platform-native
  column names despite operating on prompt-versioning data.
- `components/coverage/priority-gaps-tab.tsx` — library-frame copy, no mechanism
  leakage.

## Escape hatch — where "Claude" may appear

Permitted to reference Claude as a destination label per Rule 3:

- `/settings/connections` and related MCP connector setup UI.
- Admin-only MCP eval tooling (`/admin/mcp-eval`).
- `ClaudePromptButton` and its call sites — with action-oriented labels.
- `docs/` describing the MCP integration.

The April 2026 header revision (commits ca662c90, 9ba56bc3) retired the
standalone "Claude" header link; do not reintroduce it without a fresh
discussion against the four rules above.
