#!/usr/bin/env bash
set -euo pipefail

log() { printf '\n[post-create] %s\n' "$1"; }

# shellcheck source=.devcontainer/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

log "activating pnpm via corepack"
corepack enable
retry "corepack prepare" corepack prepare --activate
pnpm --version

log "pnpm install --frozen-lockfile"
retry "pnpm install" pnpm install --frozen-lockfile

log "playwright chromium + OS dependencies"
retry "playwright install" pnpm exec playwright install --with-deps chromium

# Optional shell plugins must not make provisioning fail on a network outage.
log "zsh plugins (autosuggestions, syntax highlighting)"
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
if [ -d "$HOME/.oh-my-zsh" ]; then
  for plugin in zsh-autosuggestions zsh-syntax-highlighting; do
    if [ ! -d "$ZSH_CUSTOM/plugins/$plugin" ]; then
      git clone --depth 1 "https://github.com/zsh-users/$plugin" \
        "$ZSH_CUSTOM/plugins/$plugin" || echo "  (skipped $plugin: clone failed)"
    fi
  done
  # Append after oh-my-zsh loads; editing its plugins list can corrupt the generated rc file.
  if [ -f "$HOME/.zshrc" ] && ! grep -q "zsh-autosuggestions" "$HOME/.zshrc"; then
    {
      printf '\n# qcms dev container (task 046)\n'
      printf 'source "$ZSH/custom/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh" 2>/dev/null\n'
      printf 'source "$ZSH/custom/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" 2>/dev/null\n'
    } >>"$HOME/.zshrc"
  fi
fi

log "done. Next: 'pnpm verify' (the full merge gate; add 'pnpm verify:browser' for UI work)"
