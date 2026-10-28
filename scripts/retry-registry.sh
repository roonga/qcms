#!/usr/bin/env bash
# The retry is conditional on the output naming a registry or transport failure,
# because a plain retry would rebuild a genuine build failure twice for nothing.
#
# Every marker must name a registry, a registry status or a transport failure in as many
# words. A bare errno is deliberately not one: a local failure produces those too.
set -uo pipefail

ATTEMPTS="${QCMS_REGISTRY_RETRY_ATTEMPTS:-3}"

# `unexpected status: 5` covers a registry 5xx without matching a 4xx, which is a real
# answer rather than an outage.
REGISTRY_MARKERS='failed to resolve source metadata|failed to resolve reference|pull access denied|authorization failed|unauthorized: authentication required|toomanyrequests|too many requests|unexpected status: 5|failed to do request|registry-1\.docker\.io|auth\.docker\.io|index\.docker\.io|context deadline exceeded|i/o timeout|connection reset by peer|TLS handshake timeout|503 Service Unavailable|502 Bad Gateway'

if [ "$#" -eq 0 ]; then
  echo "retry-registry: no command given." >&2
  exit 2
fi

log="$(mktemp)"
trap 'rm -f "${log}"' EXIT

for attempt in $(seq 1 "${ATTEMPTS}"); do
  # `PIPESTATUS` because `tee` would otherwise mask the command's own exit code.
  "$@" 2>&1 | tee "${log}"
  status="${PIPESTATUS[0]}"

  if [ "${status}" -eq 0 ]; then
    if [ "${attempt}" -gt 1 ]; then
      echo "retry-registry: succeeded on attempt ${attempt} of ${ATTEMPTS}."
    fi
    exit 0
  fi

  if ! grep -qiE "${REGISTRY_MARKERS}" "${log}"; then
    echo "retry-registry: attempt ${attempt} failed with exit ${status}, and the output names no registry or transport failure. Not retried - this is a build failure, not a Docker Hub outage." >&2
    exit "${status}"
  fi

  if [ "${attempt}" -ge "${ATTEMPTS}" ]; then
    echo "::error title=Container registry unavailable::Docker Hub pull attempt ${attempt} of ${ATTEMPTS} failed and the build could not resolve its base image or BuildKit frontend. This is a container-registry failure, not a build failure."
    exit "${status}"
  fi

  echo "Docker Hub pull attempt ${attempt} of ${ATTEMPTS} failed."
  sleep $((attempt * 10))
done
