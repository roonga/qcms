---
name: a2ra-repo-notes
description: "Working notes for the a2-react-aria repo — broken local turbo, full lint set, tripwire tests"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
---

- **Local `turbo` binary is broken on this machine** (crashes 0xC0000135 even on `--version`) in `H:\source\agent3\a2-react-aria` as of 2026-07-20. Workaround: run gates per package (`pnpm --filter @a2ra/core test|build`, same for cli). Proper fix suggested to Ravi: `pnpm install --force`. CI (Linux) unaffected.
- **The repo's full lint set is `pnpm lint` (Biome) AND `pnpm lint:md` (markdownlint, MD013 line ≤120)** — run both before the first push; missing lint:md cost a fixup commit on PR #69 and forced squash instead of the preferred rebase-merge.
- Registry tripwires: `registry-schema.test.ts` hardcodes component-type counts (bump consciously when adding a component); `build:registry` regenerates `registry/*.json` + `a2ui-schema.json` — never hand-edit those.
- Copilot review comments there can be confidently wrong (claimed markdownlint bans em dashes; config has no such rule) — verify against `.markdownlint.json` + `pnpm lint:md` before acting.
- Repo merge policy: rebase-merge preferred, squash only for branches with noisy fixups; no Co-Authored-By; never commit to main directly.
