# Sourced without changing shell options so helpers can be tested without provisioning.

# Exhausted retries must fail so provisioning cannot continue with a broken toolchain.
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
