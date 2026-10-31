cd ~/src/qcms-wt/1197
log=$(node scripts/agent-scratch.mjs verify.log)
pnpm verify > "$log" 2>&1; rc=$?
echo "EXIT=$rc"
grep -n 'FAIL\|error\|Error\|✘\|failed' "$log" | head -40
tail -45 "$log"
