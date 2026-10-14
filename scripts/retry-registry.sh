#!/usr/bin/env bash
# Retry a command, but only when it failed for a container-registry reason.
#
# Usage:  bash scripts/retry-registry.sh <command> [args...]
#
# ## Why this exists, and why it is not a plain retry
#
# `images.yml#build` builds the three release images through `pnpm qcms:build-images`,
# which uses a **docker-container** driver builder because `--sbom` requires one. That
# driver keeps its own content store and resolves every reference from the registry, so
# the pre-pull in `.github/actions/prepull-base-images` cannot help it - measured on
# 2026-10-15 by naming an image that exists in no registry and watching the same build
# succeed on the `docker` driver and fail on the docker-container one with `pull access
# denied ... authorization failed`. A Docker Hub blip therefore fails that job's build at
# the base image or at the `# syntax=docker/dockerfile:1` frontend, and the only place
# left to put a retry is around the build itself (Code Owner, 2026-10-11, issue #1050).
#
# A plain `for attempt in 1 2 3` around a fifteen-minute build is the wrong shape: a
# genuine build failure would be rebuilt twice for nothing, three times the wall clock on
# every red. So the retry is CONDITIONAL on the failure text naming a registry or a
# transport problem. Anything else fails on the first attempt, which is what a build
# failure should do.
#
# The markers are the same class `PULL_FAILURE_MARKERS` in
# `packages/db/src/testing/harness.ts` uses, with its rule kept: every marker names a
# registry, a registry status, or a transport failure in as many words. A bare errno is
# deliberately NOT one, because a local failure produces those too and retrying a local
# failure three times is the behaviour this guard exists to avoid.
set -uo pipefail

ATTEMPTS="${QCMS_REGISTRY_RETRY_ATTEMPTS:-3}"

# Case-insensitive, one alternation. `unexpected status: 5` covers a registry 5xx without
# matching a 4xx, which is a real answer rather than an outage.
REGISTRY_MARKERS='failed to resolve source metadata|failed to resolve reference|pull access denied|authorization failed|unauthorized: authentication required|toomanyrequests|too many requests|unexpected status: 5|failed to do request|registry-1\.docker\.io|auth\.docker\.io|index\.docker\.io|context deadline exceeded|i/o timeout|connection reset by peer|TLS handshake timeout|503 Service Unavailable|502 Bad Gateway'

if [ "$#" -eq 0 ]; then
  echo "retry-registry: no command given." >&2
  exit 2
fi

log="$(mktemp)"
trap 'rm -f "${log}"' EXIT

for attempt in $(seq 1 "${ATTEMPTS}"); do
  # `tee` so the operator reads the build as it happens rather than only on failure, and
  # the copy is what the marker test reads. `PIPESTATUS` because `tee` would otherwise
  # mask the command's own exit code.
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
  # The same growing 10/20/30 waits `.github/actions/test-postgres-image` and
  # `.github/actions/prepull-base-images` use, so there is one retry rhythm here.
  sleep $((attempt * 10))
done
