#!/usr/bin/env bash
# detect-drift.sh — deterministic drift flags for a skill or agent markdown file.
# Read-only. Prints candidate findings grouped by category, with file line numbers.
# Body-only: archaeology/verbosity rules apply AFTER the frontmatter boundary.
# Usage: detect-drift.sh <path-to-SKILL.md-or-agent.md>
set -u

f="${1:-}"
if [ -z "$f" ]; then echo "usage: detect-drift.sh <file>" >&2; exit 2; fi
if [ ! -f "$f" ]; then echo "not a file: $f" >&2; exit 2; fi

dir=$(dirname "$f")

# --- frontmatter boundary: first '---' line ... next '---' line ---
fm_end=0
if head -n1 "$f" | grep -qx -- '---'; then
  fm_end=$(awk 'NR>1 && /^---[[:space:]]*$/ {print NR; exit}' "$f")
  [ -z "$fm_end" ] && fm_end=0
fi

total=$(wc -l < "$f" | tr -d ' ')
chars=$(wc -c < "$f" | tr -d ' ')

# asset type + size band
case "$f" in
  */agents/*|*/agents/*.md) kind="agent"; band=10000; bandunit="chars ($chars)";;
  *) kind="skill"; band=300; bandunit="lines ($total)";;
esac

echo "## file:               $f"
echo "## kind:               $kind"
echo "## frontmatter_ends:   line $fm_end   (body = lines $((fm_end+1))..$total)"
echo "## size:               $total lines / $chars chars"
if { [ "$kind" = "skill" ] && [ "$total" -gt "$band" ]; } || \
   { [ "$kind" = "agent" ] && [ "$chars" -gt "$band" ]; }; then
  echo "## SIZE SIGNAL:        over band ($bandunit > $band) — look at C/B first; signal only, do NOT cut real instruction to hit it"
fi
echo "## NOTE: frontmatter (lines 1..$fm_end) is mandated-verbatim — never edit; hits there are expected"
echo

# body lines only, each prefixed with its real file line number "<n>:<content>"
body() { awk -v s="$fm_end" 'NR>s{printf "%d:%s\n", NR, $0}' "$f"; }

scan() {  # scan "<label>" "<extended-regex>"
  local label="$1" pat="$2" hits
  hits=$(body | grep -E -- "$pat" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "### $label"
    printf '%s\n' "$hits" | sed 's/^/  /'
    echo
  fi
}

echo "# === A: provenance archaeology (STRIP — keep rule, cut archaeology) ==="
# NOTE: catches 2-3 digit + suffixed forms (S60, S62E, S62F-WP3, s48-feedback) — the
# common archaeology shapes here, not just 3-digit. Still incomplete; eyeball after.
scan "session refs (S##/S###, suffixed)"     '\b(post-)?[Ss][0-9]{2,3}[A-Z]?(-(WP[0-9]+|feedback|B[0-9]+))?\b'
scan "subtask/task provenance ({N.M}, ID-N.M)" '\{[0-9]+\.[0-9x]+\}|\bID-[0-9]+\.[0-9]+\b'
scan "open-question / decision tags (OQ-, Q-TAG-N)" '\bOQ-S?[0-9]+|\bQ-[A-Z]+-[0-9]+\b'
scan "dated refs (ISO date, 'as of')"        '\b20[0-9]{2}-[0-9]{2}-[0-9]{2}\b|[Aa]s of '
scan "narrative archaeology"                 '[Pp]reviously|no longer|used to|briefly tried|now-moot|\blegacy\b|motivated|\bretired\b|\bdeprecated\b|\bsuperseded\b|\bformerly\b|stale (pre-|reference)'

echo "# === B: verbosity / redundancy (STRIP — collapse to one) ==="
scan "rationale/score essays"                'Why these constraints exist|Your success is measured|why this matters'
scan "boundary restatements (structural)"    'Scope guard|What this.{0,20}does NOT|What you are NOT|does NOT do\b'

echo "# === P: PROTECTED pins — code-intel anchors; do NOT extract/remove (ID-23 test-pinned) ==="
scan "code-intel markers (PROTECTED — leave verbatim)"  '<!--[[:space:]]*code-intel'
# C (un-extracted reference blocks) is judgment-based — read the body. Extract ONLY unmarked,
# untested inlined reference-grade content. Preflight: grep -rl "<string>" __tests__/ first.

echo "# === repeated long paths (B — state once) ==="
rep=$(body | grep -oE '\$\{[A-Z_]+\}[^ )`"'"'"']*|/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+){3,}' 2>/dev/null \
        | sort | uniq -c | sort -rn | awk '$1>=3 {print}' || true)
if [ -n "$rep" ]; then echo "### paths repeated >=3x"; printf '%s\n' "$rep" | sed 's/^/  /'; echo; fi

echo "# === E: stale cross-refs (FIX if unambiguous, else FLAG) ==="
refs=$(body | grep -oE '(references|scripts|assets)/[A-Za-z0-9._/-]+' 2>/dev/null | sort -u || true)
if [ -n "$refs" ]; then
  miss=""
  claude_root="${f%%/.claude/*}/.claude"
  [ -d "$claude_root" ] || claude_root="."
  while IFS= read -r r; do
    [ -z "$r" ] && continue
    # skill-relative OR repo-root (prose often cites repo-root paths like `scripts/…`)
    [ -e "$dir/$r" ] && continue
    [ -e "$r" ] && continue
    # cross-dir: a file with this basename may live under another skill/agent dir — a path
    # mismatch to verify, not necessarily a dead link (downgrades the false positive).
    elsewhere=$(find "$claude_root" -name "$(basename "$r")" -type f 2>/dev/null | head -1)
    if [ -n "$elsewhere" ]; then
      miss="$miss  CHECK PATH (basename exists at ${elsewhere#$claude_root/}; ref reads '$r' — verify): $r"$'\n'
    else
      miss="$miss  MISSING on disk: $r"$'\n'
    fi
  done <<< "$refs"
  if [ -n "$miss" ]; then echo "### orphaned reference/script links"; printf '%s' "$miss"; echo; fi
fi
scan "stale numeric budget cues"             '<=[0-9]{3,}|≤[0-9]{3,}'

echo "# === done. Flags are candidates — judge each against references/drift-taxonomy.md ==="
