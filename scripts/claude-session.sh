#!/usr/bin/env bash
# bypassPermissions gives unrestricted tool access; run only in a disposable environment.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f /.dockerenv ] && [ -z "${REMOTE_CONTAINERS:-}" ] && [ -z "${CODESPACES:-}" ]; then
  echo "WARNING: not inside a container. bypassPermissions is meant for a safe environment like the dev container (ADR-29)." >&2
fi
exec claude --permission-mode bypassPermissions --remote-control qcms-dev --resume
