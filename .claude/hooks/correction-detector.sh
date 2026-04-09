#!/bin/bash
# Correction detector stop hook
# Uses simple keyword matching on truncated assistant message

python3 -c "
import sys, json

try:
    args = json.loads(sys.stdin.read())
except:
    print(json.dumps({'ok': True}))
    sys.exit(0)

if args.get('stop_hook_active', False):
    print(json.dumps({'ok': True}))
    sys.exit(0)

msg = args.get('last_assistant_message', '')[:500].lower()

signals = [
    'i apologize', 'i apologise', 'my mistake', 'let me correct',
    \"you're right, i should\", 'sorry about that, i',
    'i was wrong', 'let me fix that'
]

if any(s in msg for s in signals):
    reason = ('SELF-IMPROVEMENT: A correction was detected. Before stopping, '
              'update ~/.claude/projects/-Users-liamj-Documents-development-knowledge-hub/'
              'memory/MEMORY.md by adding a bullet under ## Learned Rules describing '
              'the rule to prevent this. Format: - **[YYYY-MM-DD] [Category]:** Rule. Then stop.')
    print(json.dumps({'ok': False, 'reason': reason}))
else:
    print(json.dumps({'ok': True}))
"
