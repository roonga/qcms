---
name: qcms-design-system
description: "Where the QCMS visual design lives and the settled brand/token decisions"
metadata:
  node_type: memory
  type: reference
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
  modified: 2026-07-21T11:59:59.176Z
---

QCMS visual design, settled 2026-07-21 (first pass approved by Ravi, "LGTM"):

- **Brand accent: Cobalt** `#2456C6` (light) / `#7AA2FF` (dark) - QCMS's own fixed identity, used in the **admin** (internal tool). **Portal default: Slate Teal** `#2C6E63` / `#5FB8AC` - a brand-neutral, **adopter-themeable** baseline (respondents see the adopter's brand). Cool-biased neutrals; semantics success/warning/critical separate from accent. All AA-verified light+dark.
- **Token contract in the repo:** `packages/ui/src/theme.css` (the a2ra `--color-*` var contract, re-hued to the QCMS palette; renderer defaults to the portal Slate-Teal baseline, `--color-info` = Cobalt). Committed 2392e7e. Per-app globals (admin -> Cobalt, portal -> adopter override) are wired by tasks 029/031 when they scaffold the apps (portal/admin are still stubs).
- **Claude Design project:** "QCMS Design System" (projectId `c4d5d5a3-83a0-4e53-8383-5141c3f1161f`) in claude.ai/design - synced via the DesignSync tool + /design-sync skill. Cards: Overview + Foundations (color/tokens/type) + Portal (step page) + Admin (builder/responses). DesignSync create/write hung until Claude was updated 2026-07-21; reads always worked.
- **Design brief** (surface-split mandate, mobile-first portal): artifact ee6118eb-fce9-433b-854f-765a552c9c12. Design-system showcase: artifact 59e06609-b0ce-4787-a619-ff7f85c23aa1.
- Stack decision that frames all this: **[[qcms-open-decisions]]** ADR-26 (TanStack Query admin-only, portal fetch-only, react-aria forms, light+dark AA). Only design deliverable NOT yet done: the 4 non-hero admin screens (shell/2FA, library, publish, agent panel), which get designed per-task at each UI task's screenshot gate.
