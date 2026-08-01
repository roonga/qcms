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
# Usage:  bash scripts/agent-loop.sh [-p 3] [-r 30] [-m 100] [-s 010] [-P /next-issue] [-M dev2]
#           -p, --parallel N          executors per batch (pairwise-independent tasks only; /next-task lane only)
#           -P, --prompt CMD          the skill each iteration runs (default /next-task; e.g. /next-issue for a second, issue-lane agent)
#           -M, --mailbox NAME        seat-mail identity under ../seat-mail/ (default dev; a second lane gets its own, e.g. dev2)
#           -r, --retry-minutes N     wait between retries when usage-limited / crashed
#           -m, --max-iterations N    hard stop so a logic bug cannot loop forever
#           -s, --stop-after-task ID  e.g. "010" - stop once this task lands
# Stop:   Ctrl+C anytime - the running session and every process it spawned are
#         terminated with it, and the worst case is one interrupted task, which
#         the next run's stale-claim recovery picks up.
set -uo pipefail

parallel=1
retry_minutes=30
prompt_cmd="/next-task"
mailbox="dev"
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
    -P | --prompt)
      need_value "$1" "${2:-}"
      prompt_cmd="$2"
      shift 2
      ;;
    -M | --mailbox)
      need_value "$1" "${2:-}"
      case "$2" in
        */* | *..*) die "--mailbox must be a plain folder name, got '$2'" ;;
      esac
      mailbox="$2"
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
# Optional, so only checked when given. It reaches `$((10#$stop_after_task))`
# at sentinel-match time, where a non-numeric value throws a bash arithmetic
# error mid-run and the stop check then silently never fires.
[ -z "$stop_after_task" ] || positive_int --stop-after-task "$stop_after_task"

cd "$(dirname "$0")/.."
log_file="$PWD/agent-loop.log"
[ "$mailbox" != "dev" ] && log_file="$PWD/agent-loop-${mailbox}.log"
log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S')  $1"
  # Writing to a terminal that has gone away raises SIGPIPE, whose default action
  # kills the shell outright - skipping the EXIT trap, and so leaving behind
  # exactly the orphans this script now exists to prevent (issue #240). Ignoring
  # it inside a subshell downgrades that to a discarded write. The subshell
  # matters: a trap set to a command is reset in children, but one set to ''
  # is inherited as "ignored", and a session that starts life with SIGPIPE
  # ignored is not something to hand a CLI.
  (
    trap '' PIPE
    echo "$line"
    echo "$line" >>"$log_file"
  ) 2>/dev/null
}

# --- session process groups (issue #240) ------------------------------------
#
# A session spawns background work of its own: subagents, backgrounded bash
# tasks, watchers. When the session process ends - normally, on a crash, or
# because the CLI gave up on its own background tasks and terminated them - those
# descendants are reparented to init and keep running. An orphan belonging to a
# DEAD iteration that still drains ../seat-mail/<mailbox>/ can consume a steer
# the LIVE iteration then never sees: the bus is at-most-once per file
# (act-then-move ack), so a stolen message is simply lost.
#
# The supervisor therefore launches each session in its own process group and
# terminates the whole group once the session's own process has exited. `set -m`
# (job control) is what creates the group: bash gives a background job a process
# group whose id is the job's pid, and it does so before the exec, so `$!` IS the
# group id - no lookup, and no race. `setsid` (this issue's suggested means) gets
# to the same place, but the group id then has to be read back out of /proc after
# the fact, racing with setsid's own setsid(2) call.
session_reap_grace_sec=5
session_pgid=""
# Reaping a group by id is only safe if that id is not the supervisor's own, so
# the guard below needs to know what ours is.
own_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"

# Succeeds while at least one process in group $1 is alive. After the group
# leader exits, the id stays valid (and unreused) as long as any member remains,
# which is exactly the orphan case this exists to detect.
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
  # If job control did not take, the session shares our group and killing it
  # would kill this supervisor (and whatever else sits in the group). Leaving a
  # potential orphan is the lesser failure, so say so loudly and stop.
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
  # The session is over either way, so there is nothing left to shut down
  # gracefully and no reason to keep waiting on a process that ignored SIGTERM.
  kill -KILL -- "-$pgid" 2>/dev/null
  waited=0
  while [ "$waited" -lt $((session_reap_grace_sec * 10)) ]; do
    group_alive "$pgid" || return 0
    sleep 0.1
    waited=$((waited + 1))
  done
  # `kill -0` cannot tell a live member from an unreaped zombie, so this can also
  # mean the group is dead but something has not collected it yet. Either way no
  # orphan is left running, which is what the reap exists to guarantee; the cost
  # of the ambiguity is this warning and the wait above.
  log "WARNING: process group $pgid still present after SIGKILL - check for stuck processes"
}

# The session now lives in its own process group, so a terminal Ctrl+C reaches
# the supervisor but NOT the session. Forwarding it here is what keeps the
# documented "Ctrl+C anytime" true, and makes it stricter than before: the whole
# tree goes, not just the process that happened to be in the foreground.
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

prompt="$prompt_cmd"
[ "$parallel" -gt 1 ] && [ "$prompt_cmd" = "/next-task" ] && prompt="/next-task $parallel"
log "supervisor start: '$prompt' (mailbox: $mailbox), retry ${retry_minutes}m, max $max_iterations iterations"

# Sentinel and usage-limit matching are case-insensitive, like the .ps1 mirror.
shopt -s nocasematch

for ((i = 1; i <= max_iterations; i++)); do
  log "iteration ${i}: launching fresh session"

  # Seat mail (2026-07-31): deterministically deliver PO-seat messages into the
  # prompt. The next-task skill's seat-mail step is the semantic contract (what
  # messages mean, move-to-read/ as the ack); this block is the delivery
  # guarantee - an instruction is a "usually", the supervisor is an "always".
  # Act-then-move gives at-least-once: a crashed iteration redelivers.
  iter_prompt="$prompt"
  mail=""
  for f in "$PWD/../seat-mail/${mailbox}/"*.txt; do
    [ -e "$f" ] || continue
    mail="$mail
--- seat mail: $(basename "$f") ---
$(cat "$f")"
  done
  if [ -n "$mail" ]; then
    log "seat mail: delivering $(printf '%s' "$mail" | grep -c '^--- seat mail:') message(s) into the prompt"
    iter_prompt="$prompt

Seat mail from the PO seat (act on each, then move its file to ../seat-mail/${mailbox}/read/ as the ack):$mail"
  fi
  # --model is pinned so an unattended run cannot silently move models when the
  # CLI default changes (same reasoning as the agent-brief frontmatter pins).
  if [ "$mailbox" != "dev" ]; then
    iter_prompt="$iter_prompt

Lane identity: your seat-mail inbox is ../seat-mail/${mailbox}/ (ack into its read/); sign outbound mail to ../seat-mail/pm/ as 'From: ${mailbox} lane'. Follow the second-lane discipline in the next-issue skill (bug/security tier only while the e2e chain runs; avoid the live feat/* claim's footprint; flock the shared browser-gate lock)."
  fi
  #
  # The session's output goes to a file, not a command substitution. A command
  # substitution does not return until every process holding the write end of
  # the pipe has exited, so a single background descendant that inherited stdout
  # used to hang the supervisor indefinitely instead of letting it reap and move
  # on - the same orphan, wearing a different symptom.
  session_log="$(mktemp "${TMPDIR:-/tmp}/agent-loop-session-XXXXXX")"
  # Job control for this launch only, so the session gets its own process group.
  # stdin comes from /dev/null: a background process group that reads the
  # terminal is stopped with SIGTTIN, and a headless session has no use for it.
  set -m
  claude -p "$iter_prompt" --model claude-opus-5 --permission-mode bypassPermissions \
    --output-format text >"$session_log" 2>&1 </dev/null &
  session_pid=$!
  set +m
  session_pgid="$session_pid"
  wait "$session_pid"
  reap_session_group
  out="$(cat "$session_log")"
  rm -f "$session_log"
  echo "$out" >>"$log_file"
  sentinel="$(echo "$out" | grep -E '^NEXT-(TASK|ISSUE):' | tail -n 1)"

  if [[ "$sentinel" =~ NEXT-(TASK|ISSUE):\ (LANDED|RESUMED|PR[[:space:]]*#) ]]; then
    log "$sentinel"
    # Strip leading zeros so "010" matches a sentinel that says "10".
    if [ -n "$stop_after_task" ] &&
      [[ "$sentinel" =~ (LANDED|RESUMED)[[:space:]]+0*$((10#$stop_after_task))([^0-9]|$) ]]; then
      log "task $stop_after_task landed - stop-after target reached, stopping."
      break
    fi
    continue
  elif [[ "$sentinel" =~ NEXT-(TASK|ISSUE):\ NOTHING ]]; then
    log "$sentinel - ledger exhausted, stopping."
    break
  elif [[ "$sentinel" =~ NEXT-(TASK|ISSUE):\ AWAITING-HUMAN ]]; then
    log "$sentinel - human gate reached, stopping. See ledger for what's needed."
    break
  elif [[ "$sentinel" =~ NEXT-(TASK|ISSUE):\ BLOCKED ]]; then
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
