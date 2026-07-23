#!/usr/bin/env bash
# Dev container provisioning (task 046, ADR-29). Runs once, after the container
# is created, with the workspace root as the working directory.
#
# Everything here is idempotent: re-running it on an existing container is safe.
set -euo pipefail

log() { printf '\n[post-create] %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. pnpm, at exactly the version pinned by package.json's `packageManager`.
#    Corepack (not a global install) is what keeps the pin honest, and the
#    repo is pnpm-only: never npm, never yarn.
# ---------------------------------------------------------------------------
log "activating pnpm via corepack"
corepack enable
corepack prepare --activate
pnpm --version

# ---------------------------------------------------------------------------
# 2. Workspace dependencies, frozen exactly like CI.
# ---------------------------------------------------------------------------
log "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 3. Playwright's Chromium plus the OS libraries headless Chrome needs. This is
#    also what makes the Lighthouse accessibility gate work: it launches this
#    same binary through chrome-launcher.
# ---------------------------------------------------------------------------
log "playwright chromium + OS dependencies"
pnpm exec playwright install --with-deps chromium

# ---------------------------------------------------------------------------
# 4. Shell polish: oh-my-zsh comes from the common-utils Feature; add the two
#    plugins that make an interactive terminal pleasant. Non-fatal by design -
#    a network hiccup here must not fail the whole container build.
# ---------------------------------------------------------------------------
log "zsh plugins (autosuggestions, syntax highlighting)"
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
if [ -d "$HOME/.oh-my-zsh" ]; then
  for plugin in zsh-autosuggestions zsh-syntax-highlighting; do
    if [ ! -d "$ZSH_CUSTOM/plugins/$plugin" ]; then
      git clone --depth 1 "https://github.com/zsh-users/$plugin" \
        "$ZSH_CUSTOM/plugins/$plugin" || echo "  (skipped $plugin: clone failed)"
    fi
  done
  # Sourced at the END of .zshrc (rather than added to oh-my-zsh's `plugins=()`,
  # which is read before oh-my-zsh loads): appending is idempotent and cannot
  # corrupt the Feature-generated rc file.
  if [ -f "$HOME/.zshrc" ] && ! grep -q "zsh-autosuggestions" "$HOME/.zshrc"; then
    {
      printf '\n# qcms dev container (task 046)\n'
      printf 'source "$ZSH/custom/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh" 2>/dev/null\n'
      printf 'source "$ZSH/custom/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" 2>/dev/null\n'
    } >>"$HOME/.zshrc"
  fi
fi

log "done. Next: 'pnpm build && pnpm typecheck && pnpm test && pnpm lint'"
