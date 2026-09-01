#!/usr/bin/env bash
# agent-loop.sh - runs /next-work in a fresh headless root session per iteration.
# Run it inside the canonical dev container. Outside the container, use
# the interactive fallback `/loop /next-work`.
#
# Usage:  bash scripts/agent-loop.sh [-p 3] [-r 30] [-m 100] [-s 010] [-S 0]
#           -p, --parallel N          independent executor subagents per batch
#           -S, --seat N              port seat 0-9 (default 0; docs/PORTS.md)
#           -r, --retry-minutes N     wait between retries when usage-limited / crashed
#           -m, --max-iterations N    hard stop so a logic bug cannot loop forever
#           -s, --stop-after-task ID  e.g. "010" - stop once this task lands
# Stop:   Ctrl+C anytime - the running session and every process it spawned are
#         terminated with it, and the worst case is one interrupted task, which
#         the next run's stale-claim recovery picks up. A second Ctrl+C while that
#         is happening skips the grace period and SIGKILLs the group at once.
set -uo pipefail

parallel=1
retry_minutes=30
seat=""
max_iterations=100
stop_after_task=""

die() {
  echo "agent-loop: $1" >&2
  exit 2
}

need_value() { # $1 = flag, $2 = value (possibly absent)
  [ -n "$2" ] || die "$1 requires a value"
}

positive_int() { # $1 = flag, $2 = value
  case "$2" in
    '' | *[!0-9]*) die "$1 needs a positive integer, got '$2'" ;;
  esac
  [ "$2" -ge 1 ] || die "$1 needs a positive integer, got '$2'"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -p | --parallel)
      need_value "$1" "${2:-}"
      parallel="$2"
      shift 2
      ;;
    -S | --seat)
      need_value "$1" "${2:-}"
      seat="$2"
      shift 2
      ;;
    -r | --retry-minutes)
      need_value "$1" "${2:-}"
      retry_minutes="$2"
      shift 2
      ;;
    -m | --max-iterations)
      need_value "$1" "${2:-}"
      max_iterations="$2"
      shift 2
      ;;
    -s | --stop-after-task)
      need_value "$1" "${2:-}"
      stop_after_task="$2"
      shift 2
      ;;
    -h | --help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

positive_int --parallel "$parallel"
positive_int --retry-minutes "$retry_minutes"
positive_int --max-iterations "$max_iterations"
# Optional, so only checked when given. It reaches `$((10#$stop_after_task))`
# at sentinel-match time, where a non-numeric value throws a bash arithmetic
# error mid-run and the stop check then silently never fires.
[ -z "$stop_after_task" ] || positive_int --stop-after-task "$stop_after_task"

# --- port seat (R8, docs/PORTS.md) -------------------------------------------
#
# The single conductor owns one seat. Its worktrees and subagents inherit it.
[ -n "$seat" ] || seat=0
case "$seat" in
  [0-9]) ;;
  *) die "--seat must be a single digit 0-9 (got '$seat'); see docs/PORTS.md" ;;
esac
export QCMS_PORT_SEAT="$seat"

cd "$(dirname "$0")/.."
log_file="$PWD/agent-loop.log"
log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S')  $1"
  # Do not let a closed terminal skip the EXIT cleanup trap.
  (
    trap '' PIPE
    echo "$line"
    echo "$line" >>"$log_file"
  ) 2>/dev/null
}

# --- session process groups --------------------------------------------------
#
# Each session gets its own process group so all descendants can be reaped.
session_reap_grace_sec=5
session_pgid=""
own_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
# The group a reap is currently working on, and the flag a second interrupt sets.
# Together they are what makes an insistent operator heard (issue #258).
reaping_pgid=""
escalate_reap=0

group_alive() { # $1 = pgid
  kill -0 -- "-$1" 2>/dev/null
}

# Terminate everything left in the finished session's process group. Idempotent:
# it clears session_pgid first, so the EXIT trap after a signal handler is a
# no-op rather than a second round of kills against a recycled id.
#
# While the SIGTERM grace below is running, `reaping_pgid` holds the group, so a
# signal arriving mid-reap has something to act on: before issue #258 it found
# session_pgid already cleared, reaped nothing, and re-raised, which left a
# SIGTERM-ignoring descendant alive under a log line claiming everything the
# session spawned had been stopped.
reap_session_group() {
  local pgid="$session_pgid" waited=0
  session_pgid=""
  [ -n "$pgid" ] || return 0
  # Never signal the supervisor's own group. Unreachable in the current shape -
  # session_pgid is always `$!`, a fresh child pid, and own_pgid is a live group
  # leader's - and kept anyway because it is the one mistake here that would be
  # fatal rather than untidy, and because how the group id is obtained is exactly
  # the kind of thing a later change touches.
  if [ -n "$own_pgid" ] && [ "$pgid" = "$own_pgid" ]; then
    log "WARNING: session shares the supervisor's process group ($pgid) - not reaping, orphans may survive"
    return 0
  fi
  # Nothing left in the group: the normal path after a session that exited
  # cleanly, and also what a failed `set -m` looks like from here (the group was
  # never created, so `kill -0` on it fails). Silent on purpose - this runs once
  # per iteration and a warning would fire on every clean one - so the failed
  # job-control case is a silent possible orphan rather than a logged one.
  group_alive "$pgid" || return 0

  reaping_pgid="$pgid"
  escalate_reap=0
  log "session left processes running - terminating its process group ($pgid)"
  kill -TERM -- "-$pgid" 2>/dev/null
  while [ "$waited" -lt $((session_reap_grace_sec * 10)) ]; do
    group_alive "$pgid" || {
      reaping_pgid=""
      return 0
    }
    # A second interrupt means what it means to every operator: stop waiting.
    # The Code Owner ruled on 2026-08-01 that it cuts the grace short and goes
    # straight to SIGKILL, and that the escalation is logged so the operator can
    # see that it happened (issue #258).
    if [ "$escalate_reap" = 1 ]; then
      log "second interrupt - not waiting out the ${session_reap_grace_sec}s grace, killing process group $pgid now"
      break
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  kill -KILL -- "-$pgid" 2>/dev/null
  waited=0
  while [ "$waited" -lt $((session_reap_grace_sec * 10)) ]; do
    group_alive "$pgid" || {
      reaping_pgid=""
      return 0
    }
    sleep 0.1
    waited=$((waited + 1))
  done
  reaping_pgid=""
  log "WARNING: process group $pgid still present after SIGKILL - check for stuck processes"
}

# Forward supervisor signals to the active session group.
#
# Re-entrant by design: bash defers a trapped signal until the running foreground
# command returns, so a signal arriving during the reap's `sleep 0.1` re-enters
# this function. That second entry escalates and RETURNS rather than re-raising,
# leaving the first entry to finish the kill and re-raise once. Returning is what
# keeps the escalation meaningful: re-raising here would kill the supervisor
# mid-grace, which is precisely the shape that let a SIGTERM-ignoring descendant
# survive an operator pressing Ctrl+C twice.
on_signal() { # $1 = signal name
  if [ -n "$reaping_pgid" ]; then
    escalate_reap=1
    log "received SIG$1 while already stopping the session - escalating to SIGKILL"
    return 0
  fi
  log "received SIG$1 - stopping the current session and everything it spawned"
  reap_session_group
  trap - "$1"
  kill -"$1" $$
}
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP
# SIGQUIT too (issue #258): Ctrl+backslash goes to the whole foreground group, and
# without this the supervisor died on it while the session's own group - which
# job control put outside that foreground group - survived, which is the orphan
# the forwarding exists to prevent.
trap 'on_signal QUIT' QUIT
trap reap_session_group EXIT
# ----------------------------------------------------------------------------

prompt="/next-work"
[ "$parallel" -gt 1 ] && prompt="/next-work $parallel"
log "supervisor start: '$prompt', retry ${retry_minutes}m, max $max_iterations iterations"

# Sentinel and usage-limit matching are case-insensitive.
shopt -s nocasematch

for ((i = 1; i <= max_iterations; i++)); do
  log "iteration ${i}: launching fresh session"

  # A file lets the supervisor reap descendants that inherit stdout.
  session_log="$(mktemp "${TMPDIR:-/tmp}/agent-loop-session-XXXXXX")"
  # Defer signals until the new process-group id is known.
  deferred_signal=""
  trap 'deferred_signal=INT' INT
  trap 'deferred_signal=TERM' TERM
  trap 'deferred_signal=HUP' HUP
  trap 'deferred_signal=QUIT' QUIT
  # Job control creates a process group; a headless session reads from /dev/null.
  set -m
  claude -p "$prompt" --model claude-opus-5 --permission-mode bypassPermissions \
    --output-format text >"$session_log" 2>&1 </dev/null &
  session_pid=$!
  session_pgid="$session_pid"
  set +m
  trap 'on_signal INT' INT
  trap 'on_signal TERM' TERM
  trap 'on_signal HUP' HUP
  trap 'on_signal QUIT' QUIT
  [ -z "$deferred_signal" ] || on_signal "$deferred_signal"
  wait "$session_pid"
  reap_session_group
  out="$(cat "$session_log")"
  rm -f "$session_log"
  echo "$out" >>"$log_file"
  sentinel="$(echo "$out" | grep -E '^NEXT-WORK:' | tail -n 1)"

  if [[ "$sentinel" =~ NEXT-WORK:\ (LANDED|RESUMED) ]]; then
    log "$sentinel"
    # Strip leading zeros so "010" matches a sentinel that says "task 10".
    if [ -n "$stop_after_task" ] &&
      [[ "$sentinel" =~ (LANDED|RESUMED)[[:space:]]+task[[:space:]]+0*$((10#$stop_after_task))([^0-9]|$) ]]; then
      log "task $stop_after_task landed - stop-after target reached, stopping."
      break
    fi
    continue
  elif [[ "$sentinel" =~ NEXT-WORK:\ NOTHING ]]; then
    log "$sentinel - ledger exhausted, stopping."
    break
  elif [[ "$sentinel" =~ NEXT-WORK:\ AWAITING-HUMAN ]]; then
    log "$sentinel - human gate reached, stopping. See ledger for what's needed."
    break
  elif [[ "$sentinel" =~ NEXT-WORK:\ BLOCKED ]]; then
    log "$sentinel - needs a decision, stopping."
    break
  fi

  # No sentinel means the session died before reporting durable completion.
  if [ "$i" -ge "$max_iterations" ]; then
    log "no sentinel - max $max_iterations iterations reached, stopping."
    break
  fi

  # If the error names the reset time, sleep until then (+3 min buffer) instead
  # of the blind retry interval.
  sleep_sec=$((retry_minutes * 60))
  if [[ "$out" =~ reset[s]?[[:space:]]+(at[[:space:]]+)?([0-9]{1,2}(:[0-9]{2})?[[:space:]]*([ap]m)?) ]]; then
    reset_at="${BASH_REMATCH[2]}"
    if target="$(date -d "$reset_at" +%s 2>/dev/null)"; then
      now="$(date +%s)"
      # Reset time already passed today -> it is tomorrow.
      [ "$target" -lt "$now" ] && target="$(date -d "tomorrow $reset_at" +%s)"
      until_sec=$((target - now + 180))
      if [ "$until_sec" -gt 60 ] && [ "$until_sec" -lt 21600 ]; then
        sleep_sec="$until_sec"
        log "limit reset detected at $(date -d "@$target" '+%H:%M') - sleeping until then"
      fi
    fi
  fi
  [ "$sleep_sec" -eq $((retry_minutes * 60)) ] &&
    log "no sentinel (usage limit or crash assumed) - retrying in $retry_minutes minutes"
  sleep "$sleep_sec"
done
log "supervisor exit"
