# Shared helpers for dev container provisioning (task 046, ADR-29).
#
# Sourced, never executed: keeping this separate from post-create.sh is what
# lets lib.test.ts exercise the helpers without running a real provision.
# The sourcing script owns `set -euo pipefail`; nothing here sets shell options.

# Retry a network-bound command with linear backoff.
#
# Provisioning steps all reach the registry, and under `set -e` a single hiccup
# aborts the whole postCreate, leaving a half-provisioned container that has to
# be recreated by hand. Observed live: corepack failed to fetch pnpm, so the
# dependency install and the Playwright download never ran.
#
# Returns 1 after the final attempt so `set -e` still aborts on a genuine
# failure rather than continuing with a broken toolchain.
retry() { # $1 = description, rest = command to run
  local what="$1"
  shift
  local attempt=1
  local max="${RETRY_MAX_ATTEMPTS:-3}"
  until "$@"; do
    if [ "$attempt" -ge "$max" ]; then
      echo "[post-create] $what failed after $max attempts" >&2
      return 1
    fi
    echo "[post-create] $what failed (attempt $attempt/$max), retrying in $((attempt * 5))s" >&2
    sleep "$((attempt * 5))"
    attempt=$((attempt + 1))
  done
}
