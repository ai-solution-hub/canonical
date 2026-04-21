#!/bin/bash
# quality-gate.sh — Always-green Stop hook for Knowledge Hub project
# Runs tests + lint after code changes, blocks if either fails.
#
# Parallel session awareness: When multiple Claude sessions share the working
# directory, untracked files from other sessions can introduce test failures
# and lint errors. This gate temporarily hides untracked test/source files
# during checks, then restores them.

INPUT=$(cat)
STOP_ACTIVE=$(echo "$INPUT" | /usr/bin/jq -r '.stop_hook_active')

# Prevent infinite loops: if we already blocked once, allow stopping
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# Resolve to the current worktree's top-level so parallel-track worktrees
# (e.g. knowledge-hub-ui-ux-simplification, knowledge-hub-knowledge-platform)
# inspect their own tree, not main's. Falls back to main if git rev-parse
# fails (e.g. outside a repo).
PROJECT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || echo "/Users/liamj/Documents/development/knowledge-hub")
export PATH="/Users/liamj/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

# Check for code changes (unstaged + staged)
CODE_CHANGES=$(cd "$PROJECT_DIR" && git diff --name-only 2>/dev/null | grep -cE '\.(ts|tsx|js|jsx|py|json)$' || true)
STAGED_CHANGES=$(cd "$PROJECT_DIR" && git diff --cached --name-only 2>/dev/null | grep -cE '\.(ts|tsx|js|jsx|py|json)$' || true)
TOTAL_CHANGES=$(( ${CODE_CHANGES:-0} + ${STAGED_CHANGES:-0} ))

# Skip if no code files were changed
if [ "$TOTAL_CHANGES" -eq 0 ]; then
  exit 0
fi

# --- Parallel session isolation ---
# Temporarily move untracked test and source files out of the way.
# These may come from concurrent Claude sessions and cause false failures.
STASH_DIR=$(mktemp -d)
UNTRACKED=$(cd "$PROJECT_DIR" && git ls-files --others --exclude-standard \
  '__tests__/' 'app/' 'components/' 'contexts/' 'hooks/' 'lib/' 'types/' 2>/dev/null \
  | grep -E '\.(ts|tsx|js|jsx)$' || true)

if [ -n "$UNTRACKED" ]; then
  while IFS= read -r f; do
    dir=$(dirname "$f")
    mkdir -p "$STASH_DIR/$dir"
    mv "$PROJECT_DIR/$f" "$STASH_DIR/$f" 2>/dev/null || true
  done <<< "$UNTRACKED"
fi

# Cleanup function to restore files regardless of exit path
restore_untracked() {
  if [ -n "$UNTRACKED" ]; then
    while IFS= read -r f; do
      if [ -f "$STASH_DIR/$f" ]; then
        dir=$(dirname "$f")
        mkdir -p "$PROJECT_DIR/$dir"
        mv "$STASH_DIR/$f" "$PROJECT_DIR/$f" 2>/dev/null || true
      fi
    done <<< "$UNTRACKED"
  fi
  rm -rf "$STASH_DIR"
}
trap restore_untracked EXIT

# --- Run checks ---

# Tests: run only tests affected by uncommitted changes (fast feedback on stop).
# Full regression suite should be run explicitly via `bun run test` after merges.
TEST_OUTPUT=$(cd "$PROJECT_DIR" && ./node_modules/.bin/vitest run --changed 2>&1)
TEST_EXIT=$?

# Lint only files changed in THIS session (staged + unstaged vs HEAD)
# This avoids blocking on lint errors introduced by other sessions' commits
CHANGED_LINT_FILES=$(cd "$PROJECT_DIR" && git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' || true)
STAGED_LINT_FILES=$(cd "$PROJECT_DIR" && git diff --cached --name-only 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' || true)
ALL_LINT_FILES=$(echo -e "${CHANGED_LINT_FILES}\n${STAGED_LINT_FILES}" | sort -u | grep -v '^$' || true)

if [ -n "$ALL_LINT_FILES" ]; then
  # Call eslint directly on changed files (bun lint runs "eslint ." which ignores file args)
  LINT_OUTPUT=$(cd "$PROJECT_DIR" && echo "$ALL_LINT_FILES" | xargs ./node_modules/.bin/eslint 2>&1)
  LINT_EXIT=$?
else
  # No changed files to lint
  LINT_OUTPUT=""
  LINT_EXIT=0
fi

# Count actual errors (not warnings) in lint output
LINT_ERRORS=$(echo "$LINT_OUTPUT" | grep -cE '^\s+[0-9]+:[0-9]+\s+error\s' || true)
LINT_ERRORS=${LINT_ERRORS:-0}

# If tests pass and lint has no errors, allow stopping
if [ $TEST_EXIT -eq 0 ] && [ "$LINT_ERRORS" -eq 0 ]; then
  exit 0
fi

# Build failure message
FAILURES=""
if [ $TEST_EXIT -ne 0 ]; then
  FAILURES="Tests failed (exit $TEST_EXIT). Last 15 lines:\n$(echo "$TEST_OUTPUT" | tail -15)"
fi
if [ "$LINT_ERRORS" -gt 0 ]; then
  if [ -n "$FAILURES" ]; then FAILURES="$FAILURES\n\n"; fi
  FAILURES="${FAILURES}Lint has $LINT_ERRORS error(s) in tracked files. Last 15 lines:\n$(echo "$LINT_OUTPUT" | tail -15)"
fi

AGENT_NOTE="IMPORTANT FOR CLAUDE: Only fix issues that are directly related to work YOU performed in this main session. Do NOT fix issues introduced by sub-agents or concurrent sessions — those agents are responsible for their own fixes. If the failures are entirely from sub-agent work, acknowledge them but do not attempt repairs yourself."

echo -e "QUALITY GATE: Fix these issues before stopping:\n\n$FAILURES\n\n$AGENT_NOTE" >&2
exit 2
