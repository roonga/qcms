#!/usr/bin/env bash
# agent-loop.sh - supervisor for autonomous task execution that survives Claude
# usage-limit windows. Runs /next-task in a FRESH headless session each
# iteration (safe: the repo is the memory - ledger claims, task branches, and
# HANDOFFs let a new session recover anything a killed one left behind).
#
# This is the ONLY supervisor (ADR-29, amended 2026-07-25): it runs inside the
# dev container, where `--permission-mode bypassPermissions` is safe because the
# container is the blast radius. The former `agent-loop.ps1` is retired, not
# retained - a Windows contributor's supported path is the container itself
# (Docker Desktop or Codespaces). Outside the container, the interactive
# fallback is `/loop /next-task`.
#
# Usage:  bash scripts/agent-loop.sh [-p 3] [-r 30] [-m 100] [-s 010]
#           -p, --parallel N          executors per batch (pairwise-independent tasks only)
#           -r, --retry-minutes N     wait between retries when usage-limited / crashed
#           -m, --max-iterations N    hard stop so a logic bug cannot loop forever
#           -s, --stop-after-task ID  e.g. "010" - stop once this task lands
# Stop:   Ctrl+C anytime - worst case is one interrupted task, which the next
#         run's stale-claim recovery picks up.
set -uo pipefail

parallel=1
retry_minutes=30
max_iterations=100
stop_after_task=""

die() {
  echo "agent-loop: $1" >&2
  exit 2
}

# Every value-taking flag routes through this: without it, a missing value trips
# `set -u` with a bare "$2: unbound variable" that names neither the flag nor the
# script.
need_value() { # $1 = flag, $2 = value (possibly absent)
  [ -n "$2" ] || die "$1 requires a value"
}

# The numeric flags are used unquoted in arithmetic contexts, where a non-numeric
# value does not error - it evaluates to 0. `-m abc` would silently run zero
# iterations and exit looking like a clean "nothing to do" run, so validate here
# rather than let the loop no-op.
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
      sed -n '2,20p' "$0"
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

cd "$(dirname "$0")/.."
log_file="$PWD/agent-loop.log"
log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S')  $1"
  echo "$line"
  echo "$line" >>"$log_file"
}

prompt="/next-task"
[ "$parallel" -gt 1 ] && prompt="/next-task $parallel"
log "supervisor start: '$prompt', retry ${retry_minutes}m, max $max_iterations iterations"

# Sentinel and usage-limit matching are case-insensitive, like the .ps1 mirror.
shopt -s nocasematch

for ((i = 1; i <= max_iterations; i++)); do
  log "iteration ${i}: launching fresh session"
  out="$(claude -p "$prompt" --permission-mode bypassPermissions --output-format text 2>&1)"
  echo "$out" >>"$log_file"
  sentinel="$(echo "$out" | grep '^NEXT-TASK:' | tail -n 1)"

  if [[ "$sentinel" =~ NEXT-TASK:\ (LANDED|RESUMED) ]]; then
    log "$sentinel"
    # Strip leading zeros so "010" matches a sentinel that says "10".
    if [ -n "$stop_after_task" ] &&
      [[ "$sentinel" =~ (LANDED|RESUMED)[[:space:]]+0*$((10#$stop_after_task))([^0-9]|$) ]]; then
      log "task $stop_after_task landed - stop-after target reached, stopping."
      break
    fi
    continue
  elif [[ "$sentinel" =~ NEXT-TASK:\ NOTHING ]]; then
    log "$sentinel - ledger exhausted, stopping."
    break
  elif [[ "$sentinel" =~ NEXT-TASK:\ AWAITING-HUMAN ]]; then
    log "$sentinel - human gate reached, stopping. See ledger for what's needed."
    break
  elif [[ "$sentinel" =~ NEXT-TASK:\ BLOCKED ]]; then
    log "$sentinel - needs a decision, stopping."
    break
  fi

  # No sentinel - session died mid-flight: usage limit, network, crash. State is
  # safe on disk; wait out the window and let recovery handle it. If the error
  # names the reset time, sleep until then (+3 min buffer) instead of the blind
  # retry interval.
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
