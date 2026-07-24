---
name: pm-pr-self-review
description: Mandatory pre-PR self-review gate for the PM seat, and why it exists (Copilot caught what we did not, 2026-07-25)
metadata:
  type: feedback
---

Before opening or updating any PR from this seat: read the full diff as a stranger would, then grep the **added lines** for (1) em dash U+2014, (2) the Code Owner's name, (3) user-specific absolute paths (`/home/<user>`, `H:\`), and check that file paths in prose are repo-root-relative.

**Why:** On PR #41 (2026-07-25) Copilot caught four issues the seat shipped: em dashes on edited lines, a user-specific `/home/` path, and ambiguous script paths. Root causes were (a) verifying against the CI gate instead of the written rule - the em-dash gate excludes `plan/**`, but the rule is "no em dash anywhere" - and (b) no reviewer pass at all between writing and pushing. The Code Owner made the fix a standing process requirement.

**How to apply:** The checklist is codified in `plan/CLAUDE.md` Ground rules ("Before opening or updating any PR"). Two principles generalize past the specific greps: verify against the **rule**, not the enforcement mechanism (gates are a subset of the rules); and any line in the diff is **yours** - a pre-existing file's style does not excuse a violation on a line you edited. See [[code-owner-preferences]].
