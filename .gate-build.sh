#!/usr/bin/env bash
set -u
cd /home/ravi/src/qcms-wt/fix-1121 || exit 1
log=$(node scripts/agent-scratch.mjs build.log)
echo "LOG=$log"
pnpm build > "$log" 2>&1
rc=$?
echo "EXIT=$rc"
tail -25 "$log"
