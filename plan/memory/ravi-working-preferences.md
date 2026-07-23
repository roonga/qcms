---
name: ravi-working-preferences
description: "How Ravi works and decisions he's made that govern my behavior on qcms"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
---

- **No AI attribution trailers in commits** (no Co-Authored-By/Claude-Session). **Why:** explicit instruction 2026-07-19; history was rewritten to strip them. **How to apply:** never add them in any qcms/a2ra repo; the rule is also in qcms CLAUDE.md.
- **Vendor-agnostic over vendor-specific tooling** (chose Vercel AI SDK over Anthropic SDK for 041; local models first-class). **Why:** project constitution says vendor-agnostic, adopters bring their own LLM. **How to apply:** default to open/pluggable choices; single-vendor code needs a seam.
- **Decides fast, in short messages** ("ok", "yes", "1", "strip") after being given a crisp recommendation with trade-offs. **How to apply:** lead with a recommendation, make options cheap to choose between, then execute fully without re-asking.
- **Wants artifacts upfront** (wireframes drafted during planning, not deferred). **How to apply:** when he asks "where is X", offer to produce X now with honest draft-status marking.
- Solo dev, deep ASP.NET background, Next.js FE; explain unfamiliar TS-backend idioms briefly, map to .NET when natural (also in PROJECT_INSTRUCTIONS).
- pnpm only; a2ra design system single-sourced; prefers cleaning history/workspace clutter promptly.
- **No em dash (`—`) in anything I write** - prose, comments, commit messages, UI, chat. **Why:** it reads as an AI-generated tell and his repos are public-facing; he noticed and objected 2026-07-21. **How to apply:** use a colon, comma, parentheses, period, or spaced hyphen; en dash `–` is fine for ranges. In qcms this is a written rule + `check:no-em-dash` CI gate; treat it as a standing style rule across all his repos, not just qcms.
