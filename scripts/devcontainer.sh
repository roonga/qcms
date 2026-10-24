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
set -uo pipefail

CONTAINER="qcms-dev-container"
cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"
CONFIG=".devcontainer/devcontainer.json"

die() {
  echo "devcontainer.sh: $1" >&2
  exit 2
}

devcontainer_cli() {
  if command -v devcontainer >/dev/null 2>&1; then
    devcontainer "$@"
  else
    pnpm dlx @devcontainers/cli "$@"
  fi
}

# On the supported Windows path a missing CLI is nearly always Docker Desktop's WSL
# integration being off for this distro, so the message says that.
require_docker() {
  command -v docker >/dev/null 2>&1 || die "the docker CLI was not found on PATH.
                 On WSL2 this usually means Docker Desktop is not running, or its
                 integration is not enabled for this distro (Settings > Resources >
                 WSL integration). Elsewhere, install Docker or start the daemon."
}

# The exit status must be tested as well as the output: WSL's command_not_found handler
# writes to STDOUT, so `2>/dev/null` does not suppress it and output alone reads as a
# result. These have to tell no output from output that happens to be an error.
is_running() {
  local out
  out="$(docker ps -q --filter "name=^${CONTAINER}$" 2>/dev/null)" || return 1
  [ -n "$out" ]
}
exists() {
  local out
  out="$(docker ps -aq --filter "name=^${CONTAINER}$" 2>/dev/null)" || return 1
  [ -n "$out" ]
}

# The mounted host Docker socket (ADR-29) lets anything inside the container stop that
# same container, killing every session in it with nothing left able to report why, and
# the 137 the killed processes report reads like an out-of-memory kill. So the
# destructive verbs refuse from inside, at this one chokepoint.
#
# Detection is two-sided because the marker is authoritative but `containerEnv` only
# reaches a container on its next rebuild, so the hostname match covers older ones.
MARKER_ENV="QCMS_DEVCONTAINER"

inside_target_container() {
  [ "${QCMS_DEVCONTAINER:-}" = "$CONTAINER" ] && return 0
  [ -f /.dockerenv ] || return 1

  local host id
  host="$(hostname 2>/dev/null)" || return 1
  # An empty hostname would make the prefix test below match everything, firing the
  # guard on the host.
  [ -n "$host" ] || return 1
  id="$(docker inspect -f '{{.Id}}' "$CONTAINER" 2>/dev/null)" || return 1
  [ -n "$id" ] || return 1

  # Docker sets the hostname to the container's short id unless the config overrides
  # it, which this config does not.
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

# Asked of the container, because deriving it from the local directory name is wrong
# the moment the two differ (a worktree, a second clone). The sibling mount this config
# also creates under /workspaces is skipped.
workspace_dir() {
  # grep rather than a `hasPrefix` template: that function is missing from some Docker
  # template engines and fails by returning nothing, which reads as "no workspace mount".
  docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$CONTAINER" 2>/dev/null |
    grep '^/workspaces/' | grep -v '^/workspaces/a2-react-aria$' | head -n 1
}

# `devcontainer up` silently reuses a running container and ignores changed
# runArgs/appPort/containerEnv, so an edited config appears to apply and does not.
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
  require_docker
  devcontainer_cli up --workspace-folder "$REPO_ROOT" || die "devcontainer up failed"
  warn_if_stale
}

cmd_rebuild() {
  # Refuse first, so it never depends on Docker answering.
  inside_target_container && refuse_from_inside rebuild
  require_docker
  # By name, not `--remove-existing-container`: that flag matches on a
  # `devcontainer.local_folder` label, and the editor records a UNC path
  # (\\wsl.localhost\...) where the CLI under WSL2 records a POSIX one, so neither
  # sees the other's container.
  if exists; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 && echo "removed existing $CONTAINER"
  fi
  devcontainer_cli up --workspace-folder "$REPO_ROOT" || die "devcontainer rebuild failed"
}

cmd_shell() {
  require_docker
  is_running || die "$CONTAINER is not running. Start it with: $0 up"
  warn_if_stale
  # -u vscode is required: exec defaults to root, which writes root-owned files into
  # the bind mount and breaks the next run.
  local ws
  ws="$(workspace_dir)"
  [ -n "$ws" ] || die "could not determine the workspace path inside $CONTAINER"
  # The gh config is bind-mounted from the host, so an unauthenticated container almost
  # always means the host is not logged in.
  if ! docker exec -u vscode "$CONTAINER" sh -c 'command -v gh' >/dev/null 2>&1; then
    echo "WARNING: gh is not installed in $CONTAINER - the loops need it. Rebuild the container (the github-cli Feature provides it)." >&2
  elif ! docker exec -u vscode "$CONTAINER" gh auth status >/dev/null 2>&1; then
    echo "WARNING: gh is not authenticated in $CONTAINER. Run 'gh auth login' on the host (the config is bind-mounted) or inside this shell." >&2
  fi
  docker exec -it -u vscode -w "$ws" "$CONTAINER" zsh
}

cmd_run() {
  [ "$#" -gt 0 ] || die "run needs a command, e.g. $0 run 'pnpm build'"
  require_docker
  is_running || die "$CONTAINER is not running. Start it with: $0 up"
  local ws
  ws="$(workspace_dir)"
  [ -n "$ws" ] || die "could not determine the workspace path inside $CONTAINER"
  docker exec -u vscode -w "$ws" "$CONTAINER" bash -lc "$*"
}

cmd_status() {
  require_docker
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
  # Guard before the is_running probe, so this path never reaches `docker stop`.
  inside_target_container && refuse_from_inside stop
  require_docker
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
