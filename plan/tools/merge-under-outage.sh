#!/usr/bin/env bash
#
# Merge one PR while GitHub Actions cannot produce checks.
# Procedure and policy: plan/ci-outage-protocol.md. Temporary; delete with it.
#
# What it does: saves the protect-main ruleset, removes ONLY the
# required_status_checks rule, squash-merges the PR, restores the ruleset, then
# verifies the restore. Every other protection (no deletion, no force-push, linear
# history, PR required) stays enforced throughout.
#
# Usage:  plan/tools/merge-under-outage.sh <pr-number> <expected-head-sha>
#
# The expected head SHA is mandatory and is checked against the live head before
# anything is touched: a rebase since the evidence was posted invalidates the
# evidence, exactly as it invalidates a review sentinel.

set -euo pipefail

REPO="roonga/qcms"
RULESET_ID="19714021"

PR="${1:-}"
EXPECTED_HEAD="${2:-}"

if [ -z "$PR" ] || [ -z "$EXPECTED_HEAD" ]; then
  echo "usage: $0 <pr-number> <expected-head-sha>" >&2
  exit 64
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
saved="$work/ruleset.json"
patch="$work/patch.json"

say() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

# --- preflight -------------------------------------------------------------

live_head="$(gh pr view "$PR" -R "$REPO" --json headRefOid -q .headRefOid)"
if [ "$live_head" != "$EXPECTED_HEAD" ]; then
  echo "REFUSING: PR #$PR head is $live_head, expected $EXPECTED_HEAD." >&2
  echo "The branch moved since the evidence was posted. Re-verify at the new head." >&2
  exit 65
fi

state="$(gh pr view "$PR" -R "$REPO" --json state -q .state)"
if [ "$state" != "OPEN" ]; then
  echo "REFUSING: PR #$PR is $state, not OPEN." >&2
  exit 65
fi

gh api "repos/$REPO/rulesets/$RULESET_ID" > "$saved"

before="$(node -e '
  const r = require(process.argv[1]);
  const rsc = (r.rules || []).find(x => x.type === "required_status_checks");
  process.stdout.write(rsc ? String(rsc.parameters.required_status_checks.length) : "0");
' "$saved")"

if [ "$before" != "4" ]; then
  echo "REFUSING: expected 4 required contexts before starting, found $before." >&2
  echo "The ruleset is not in the state this script knows how to restore. Inspect it by hand." >&2
  exit 66
fi

say "preflight OK: PR #$PR at $EXPECTED_HEAD, 4 required contexts present"

# Build the reduced ruleset (everything except required_status_checks) and the
# restore payload, both up front, so the window contains no computation.
node -e '
  const r = require(process.argv[1]);
  const body = t => JSON.stringify({
    name: r.name, target: r.target, enforcement: r.enforcement,
    conditions: r.conditions, bypass_actors: r.bypass_actors,
    rules: t ? r.rules : r.rules.filter(x => x.type !== "required_status_checks"),
  });
  require("fs").writeFileSync(process.argv[2], body(false));
  require("fs").writeFileSync(process.argv[3], body(true));
' "$saved" "$patch" "$work/restore.json"

# --- the window ------------------------------------------------------------

restore() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if gh api -X PUT "repos/$REPO/rulesets/$RULESET_ID" --input "$work/restore.json" >/dev/null 2>&1; then
      return 0
    fi
    say "restore attempt $attempt failed, retrying"
    sleep 2
  done
  return 1
}

# From here until the restore verifies, an interrupt must still put the rule back.
trap 'say "INTERRUPTED - restoring"; restore || echo "RESTORE FAILED - RESTORE BY HAND NOW: repos/'"$REPO"'/rulesets/'"$RULESET_ID"'" >&2; rm -rf "$work"; exit 70' INT TERM

say "opening window: removing required_status_checks"
gh api -X PUT "repos/$REPO/rulesets/$RULESET_ID" --input "$patch" >/dev/null

merge_rc=0
say "merging PR #$PR"
gh pr merge "$PR" -R "$REPO" --squash --delete-branch || merge_rc=$?

say "closing window: restoring required_status_checks"
if ! restore; then
  echo "RESTORE FAILED after 5 attempts. main is missing its status-check rule." >&2
  echo "RESTORE BY HAND NOW: gh api -X PUT repos/$REPO/rulesets/$RULESET_ID --input <saved>" >&2
  cp "$work/restore.json" "./RESTORE-THIS-RULESET.json"
  echo "Payload written to ./RESTORE-THIS-RULESET.json" >&2
  trap - INT TERM
  exit 71
fi

trap - INT TERM

# --- verify the restore, do not assume it ----------------------------------

after="$(gh api "repos/$REPO/rulesets/$RULESET_ID" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const r = JSON.parse(s);
    const rsc = (r.rules || []).find(x => x.type === "required_status_checks");
    const names = rsc ? rsc.parameters.required_status_checks.map(c => c.context).sort() : [];
    process.stdout.write(`${r.enforcement}|${names.length}|${names.join(",")}`);
  });
')"

expected="active|4|api-e2e,full-stack-e2e,portal-e2e,verify (node-24)"
if [ "$after" != "$expected" ]; then
  echo "RESTORE VERIFY FAILED." >&2
  echo "  expected: $expected" >&2
  echo "  actual:   $after" >&2
  exit 72
fi

say "restore verified: $after"

if [ "$merge_rc" -ne 0 ]; then
  echo "NOTE: the merge itself failed (exit $merge_rc). The ruleset is intact." >&2
  exit "$merge_rc"
fi

say "merged PR #$PR at $EXPECTED_HEAD"
echo
echo "Now append a row to the ledger in plan/ci-outage-protocol.md."
