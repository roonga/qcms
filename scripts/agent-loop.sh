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
#         the next run's stale-claim recovery picks up.
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
      sed -n '2,14p' "$0"
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

group_alive() { # $1 = pgid
  kill -0 -- "-$1" 2>/dev/null
}

# Terminate everything left in the finished session's process group. Idempotent:
# it clears session_pgid first, so the EXIT trap after a signal handler is a
# no-op rather than a second round of kills against a recycled id.
reap_session_group() {
  local pgid="$session_pgid" waited=0
  session_pgid=""
  [ -n "$pgid" ] || return 0
  # Never signal the supervisor's own group.
  if [ -n "$own_pgid" ] && [ "$pgid" = "$own_pgid" ]; then
    log "WARNING: session shares the supervisor's process group ($pgid) - not reaping, orphans may survive"
    return 0
  fi
  group_alive "$pgid" || return 0
  log "session left processes running - terminating its process group ($pgid)"
  kill -TERM -- "-$pgid" 2>/dev/null
  while [ "$waited" -lt $((session_reap_grace_sec * 10)) ]; do
    group_alive "$pgid" || return 0
    sleep 0.1
    waited=$((waited + 1))
  done
  kill -KILL -- "-$pgid" 2>/dev/null
  waited=0
  while [ "$waited" -lt $((session_reap_grace_sec * 10)) ]; do
    group_alive "$pgid" || return 0
    sleep 0.1
    waited=$((waited + 1))
  done
  log "WARNING: process group $pgid still present after SIGKILL - check for stuck processes"
}

# Forward supervisor signals to the active session group.
on_signal() { # $1 = signal name
  log "received SIG$1 - stopping the current session and everything it spawned"
  reap_session_group
  trap - "$1"
  kill -"$1" $$
}
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP
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
