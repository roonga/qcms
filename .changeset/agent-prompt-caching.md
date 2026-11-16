---
"create-qcms-app": patch
---

Cache the scaffolded assistant's stable prompt prefix (issue #1304).

- Cache breakpoints ride the system prompt and the last settled message, and the per-turn
  screen facts and draft are sent after the history rather than before it, so a later step
  of a turn reads the prefix instead of resending it.
- The turn log gains `cacheReadTokens` and `cacheWriteTokens`, both zero on a provider that
  reports no cache accounting.
