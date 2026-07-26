#!/usr/bin/env bash
# Start the PO-seat Claude Code session (cwd = plan/)
# with the loop's standard flags.
#
# SAFETY NOTE: --permission-mode bypassPermissions gives the session
# unrestricted tool access. It is meant to be run ONLY in a safe, disposable
# environment such as the dev container (ADR-29: the container is the blast
# radius). Do not run it in a host shell you care about.
#
# --remote-control qcms-dev names the Remote Control channel (reachable from
# the Claude mobile/web apps); --resume picks up the most recent session for
# this directory instead of starting cold.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f /.dockerenv ] && [ -z "${REMOTE_CONTAINERS:-}" ] && [ -z "${CODESPACES:-}" ]; then
  echo "WARNING: not inside a container. bypassPermissions is meant for a safe environment like the dev container (ADR-29)." >&2
fi
exec claude --permission-mode bypassPermissions --remote-control qcms-dev --resume
