#!/usr/bin/env bash
set -u
cd /home/ravi/src/qcms-wt/fix-1121 || exit 1
log=$(node scripts/agent-scratch.mjs verify.log)
echo "LOG=$log"
pnpm verify > "$log" 2>&1
rc=$?
echo "EXIT=$rc"
grep -nE "FAIL|✗|Error:|error TS|failed|problem\(s\)" "$log" | head -40
echo "---- tail"
tail -25 "$log"
