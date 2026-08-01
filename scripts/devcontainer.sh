#!/usr/bin/env bash
# devcontainer.sh - drive the qcms dev container without VS Code (task 046,
# ADR-29). The container is the canonical dev environment; this is the CLI seat.
#
# Usage:  bash scripts/devcontainer.sh <command>
#   up        build/start the container (reuses a running one)
#   rebuild   recreate from scratch - REQUIRED after editing devcontainer.json
#   shell     open zsh inside (repeat for more terminals)
#   run <cmd> run one command inside and exit
#   status    what is running, and whether the config has drifted
#   stop      stop the container (deprecated, kept for compatibility)
#   down      stop the container
#
# Exercising this path is also evidence for exit criterion 1, which is worded
# against `devcontainer up` rather than the VS Code route.
set -uo pipefail

CONTAINER="qcms-dev-container"
cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"
CONFIG=".devcontainer/devcontainer.json"

die() {
  echo "devcontainer.sh: $1" >&2
  exit 2
}

# Prefer a global install; fall back to pnpm dlx so no global install is needed.
devcontainer_cli() {
  if command -v devcontainer >/dev/null 2>&1; then
    devcontainer "$@"
  else
    pnpm dlx @devcontainers/cli "$@"
  fi
}

is_running() { [ -n "$(docker ps -q --filter "name=^${CONTAINER}$" 2>/dev/null)" ]; }
exists() { [ -n "$(docker ps -aq --filter "name=^${CONTAINER}$" 2>/dev/null)" ]; }

# The container mounts the host Docker socket so Testcontainers works (ADR-29),
# which also hands anything running inside it the authority to stop that same
# container - killing every session in there, with no surviving process able to
# report why. That is not hypothetical: on 2026-08-01 the container recorded a
# clean exit 0 and 4m38s of downtime because a test invoked `stop` for real
# (issues #244 and #260), and the 137 the killed processes report reads exactly
# like an out-of-memory kill, so it was misdiagnosed twice.
#
# The destructive verbs therefore refuse from inside the target container. This
# is a chokepoint every caller of this script passes through rather than a
# convention each of them has to remember, which is the whole point: a rule only
# works while everyone obeys it, and its failure mode here is silent and total.
#
# Detection is deliberately two-sided. The marker is authoritative, but
# containerEnv does not reach an already-running container (the same trap
# warn_if_stale exists for), so it only arrives on the next rebuild. Matching the
# hostname against the container's own id covers every container created before
# this landed, including the one this is landing from.
MARKER_ENV="QCMS_DEVCONTAINER"

inside_target_container() {
  [ "${QCMS_DEVCONTAINER:-}" = "$CONTAINER" ] && return 0
  [ -f /.dockerenv ] || return 1

  local host id
  host="$(hostname 2>/dev/null)" || return 1
  # An empty hostname would turn the prefix test below into a match against
  # everything, so the guard would fire on the host and block legitimate use.
  [ -n "$host" ] || return 1
  id="$(docker inspect -f '{{.Id}}' "$CONTAINER" 2>/dev/null)" || return 1
  [ -n "$id" ] || return 1

  # Docker sets the container's hostname to its short id unless the config
  # overrides it; this config does not. A prefix strip that changes the string
  # means the id starts with our hostname, so we are that container.
  [ "${id#"$host"}" != "$id" ]
}

refuse_from_inside() {
  local verb="$1"
  die "refusing to $verb $CONTAINER from inside $CONTAINER.
                 This shell is running in the container it was asked to $verb, so doing it
                 would kill this process and every other session in there. Run it from the
                 host instead. The guard identifies the container by $MARKER_ENV, or by
                 matching this hostname against the container id when that is not set."
}

# The workspace path inside the container is a property of the container, not of
# wherever this script is invoked from - deriving it from the local directory
# name is wrong the moment the two differ (a worktree, a second clone). Ask the
# container, and skip the a2-react-aria sibling mount (ADR-22) this config also
# creates under /workspaces.
workspace_dir() {
  # Filtered with grep rather than a `hasPrefix` template: that function is not
  # available in every Docker version's template engine and fails by returning
  # nothing, which is indistinguishable from "no workspace mount".
  docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$CONTAINER" 2>/dev/null |
    grep '^/workspaces/' | grep -v '^/workspaces/a2-react-aria$' | head -n 1
}

# `devcontainer up` silently reuses a running container and ignores changed
# runArgs/appPort/containerEnv, so an edited config appears to apply and does
# not. Comparing the config's mtime to the container's creation time is what
# turns that silent no-op into a visible warning.
config_is_newer() {
  is_running || return 1
  local created config_mtime
  created="$(docker inspect -f '{{.Created}}' "$CONTAINER" 2>/dev/null)" || return 1
  created="$(date -d "$created" +%s 2>/dev/null)" || return 1
  config_mtime="$(stat -c %Y "$CONFIG" 2>/dev/null)" || return 1
  [ "$config_mtime" -gt "$created" ]
}

warn_if_stale() {
  if config_is_newer; then
    echo "devcontainer.sh: WARNING - $CONFIG changed after this container was created." >&2
    echo "                 Its runArgs/appPort/containerEnv are NOT applied. Run: $0 rebuild" >&2
  fi
}

cmd_up() {
  devcontainer_cli up --workspace-folder "$REPO_ROOT" || die "devcontainer up failed"
  warn_if_stale
}

cmd_rebuild() {
  inside_target_container && refuse_from_inside rebuild
  # Remove by name rather than relying on `--remove-existing-container`. That
  # flag finds the container through a `devcontainer.local_folder` label, and
  # the two launchers disagree about the same folder: VS Code on Windows records
  # a UNC path (\\wsl.localhost\...), the CLI under WSL2 records a POSIX one. So
  # a container created in the editor is invisible to the CLI, nothing gets
  # removed, and the fixed --name then collides. The name is unambiguous.
  if exists; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 && echo "removed existing $CONTAINER"
  fi
  devcontainer_cli up --workspace-folder "$REPO_ROOT" || die "devcontainer rebuild failed"
}

cmd_shell() {
  is_running || die "$CONTAINER is not running. Start it with: $0 up"
  warn_if_stale
  # docker exec rather than `devcontainer exec`: it is faster, and containerEnv
  # rides along either way. -u vscode matters - exec defaults to root, which
  # writes root-owned files into the bind mount and breaks the next run.
  local ws
  ws="$(workspace_dir)"
  [ -n "$ws" ] || die "could not determine the workspace path inside $CONTAINER"
  # gh auth is load-bearing for the loops (PR review, issue churn). The config is
  # bind-mounted from the host, so an unauthenticated container almost always
  # means the HOST is not logged in - say so before dropping into the shell.
  if ! docker exec -u vscode "$CONTAINER" sh -c 'command -v gh' >/dev/null 2>&1; then
    echo "WARNING: gh is not installed in $CONTAINER - the loops need it. Rebuild the container (the github-cli Feature provides it)." >&2
  elif ! docker exec -u vscode "$CONTAINER" gh auth status >/dev/null 2>&1; then
    echo "WARNING: gh is not authenticated in $CONTAINER. Run 'gh auth login' on the host (the config is bind-mounted) or inside this shell." >&2
  fi
  docker exec -it -u vscode -w "$ws" "$CONTAINER" zsh
}

cmd_run() {
  [ "$#" -gt 0 ] || die "run needs a command, e.g. $0 run 'pnpm build'"
  is_running || die "$CONTAINER is not running. Start it with: $0 up"
  local ws
  ws="$(workspace_dir)"
  [ -n "$ws" ] || die "could not determine the workspace path inside $CONTAINER"
  docker exec -u vscode -w "$ws" "$CONTAINER" bash -lc "$*"
}

cmd_status() {
  if is_running; then
    echo "running: $CONTAINER"
    docker ps --filter "name=^${CONTAINER}$" --format '  ports: {{.Ports}}'
    warn_if_stale
  elif exists; then
    echo "stopped: $CONTAINER (start it with: $0 up)"
  else
    echo "not created (create it with: $0 up)"
  fi
  # The dev database is a separate compose project, not part of the container.
  docker ps --filter "name=qcms-dev-postgres" --format 'dev database: {{.Names}} {{.Status}}'
}

cmd_stop() {
  # Guard before the is_running probe, so the refusal does not depend on the
  # daemon answering: the point is that this path never reaches `docker stop`.
  inside_target_container && refuse_from_inside stop
  is_running || {
    echo "$CONTAINER is not running"
    return 0
  }
  docker stop "$CONTAINER" >/dev/null && echo "stopped $CONTAINER"
}

[ "$#" -gt 0 ] || die "no command given. One of: up, rebuild, shell, run, status, stop, down"
command="$1"
shift

case "$command" in
  up) cmd_up ;;
  rebuild) cmd_rebuild ;;
  shell) cmd_shell ;;
  run) cmd_run "$@" ;;
  status) cmd_status ;;
  stop|down) cmd_stop ;;
  -h | --help | help) sed -n '2,13p' "$0" ;;
  *) die "unknown command: $command (expected up, rebuild, shell, run, status, stop, down)" ;;
esac
