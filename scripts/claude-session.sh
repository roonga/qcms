#!/usr/bin/env bash
# SAFETY: bypassPermissions gives the session unrestricted tool access. Run it only in
# a disposable environment such as the dev container, which is the blast radius (ADR-29).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f /.dockerenv ] && [ -z "${REMOTE_CONTAINERS:-}" ] && [ -z "${CODESPACES:-}" ]; then
  echo "WARNING: not inside a container. bypassPermissions is meant for a safe environment like the dev container (ADR-29)." >&2
fi
exec claude --permission-mode bypassPermissions --remote-control qcms-dev --resume
