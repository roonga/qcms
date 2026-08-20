#!/usr/bin/env bash
set -uo pipefail
cd /workspaces/qcms/.claude/worktrees/514-tables
LOG=.gatelogs/gates.log
: > "$LOG"
export QCMS_PORT_SEAT=6

run() {
  echo "=== BEGIN $1 ===" >> "$LOG"
  shift
  ( "$@" ) >> "$LOG" 2>&1
  echo "=== EXIT $? ===" >> "$LOG"
}

flock -w 2400 /workspaces/seat-mail/.gates.lock bash -c '
  cd /workspaces/qcms/.claude/worktrees/514-tables
  LOG=.gatelogs/gates.log
  export QCMS_PORT_SEAT=6

  echo "=== BEGIN capture ===" >> "$LOG"
  QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-514 >> "$LOG" 2>&1
  echo "=== EXIT capture $? ===" >> "$LOG"

  echo "=== BEGIN turbo test --force ===" >> "$LOG"
  pnpm exec turbo run test --force >> "$LOG" 2>&1
  echo "=== EXIT turbo-test $? ===" >> "$LOG"

  echo "=== BEGIN verify ===" >> "$LOG"
  pnpm verify >> "$LOG" 2>&1
  echo "=== EXIT verify $? ===" >> "$LOG"

  echo "=== BEGIN verify:browser ===" >> "$LOG"
  pnpm verify:browser >> "$LOG" 2>&1
  echo "=== EXIT verify-browser $? ===" >> "$LOG"
'
echo "=== ALL GATES FINISHED ===" >> "$LOG"
