#!/bin/bash
# Mock claude binary used by hook_journal_tests.
# Records its invocation args (one line per call) to $MOCK_CLAUDE_LOG.
# Sleeps if $MOCK_CLAUDE_SLEEP is set (used by the backgrounded-not-blocking test).
if [ -n "${MOCK_CLAUDE_LOG:-}" ]; then
    printf "%s\n" "$*" >> "$MOCK_CLAUDE_LOG"
fi
if [ -n "${MOCK_CLAUDE_SLEEP:-}" ]; then
    sleep "$MOCK_CLAUDE_SLEEP"
fi
exit 0
