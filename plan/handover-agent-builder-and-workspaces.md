# Handover: agent builder and Workspaces area

Status: 2026-11-12. Branch `chore/agent-builder-decisions` equals `origin/main` at c901780b with no commits of its own; this file is the only change on it. Nothing here is built in code: the work is rulings, plans, Design canvases and design system cards.

## Where things are

| What | Where |
| --- | --- |
| Branch | `chore/agent-builder-decisions` (rebased on `origin/main`, local only) |
| Agent builder rulings Q1 to Q13, review findings, work plan | `plan/agent-builder-decisions.md` |
| Agent builder entry and mode chrome brief | `plan/design-brief-agent-builder-entry.md` |
| Agent builder feature spec | `docs/features/041-agent-form-building.md` |
| Workspaces brief and review | `plan/design-brief-workspaces.md`, `plan/workspaces-review.md` |
| Admin app map (routes and flows) | `plan/app-map.md` |
| Other briefs from the same pass | `plan/design-brief-help-icon.md`, `plan/design-brief-operations-toolbar.md`, `plan/design-brief-per-environment-status.md`, `plan/design-brief-workspace-context.md` |
| Admin contracts (rail 7.0, 7.00, 7.01) | `plan/admin-design-contracts.md` |
| Navigating the admin | `docs/form-publishing-flow.md` |
| Admin UX program queue | GitHub issue #1162 |
| QCMS design system artifact | https://claude.ai/artifact/Cf4ksVkigAQiy5ohmHXaa6 (version 88) |
| Workspaces Design canvas (18 boards) | https://claude.ai/artifact/S1Mt2WFT52Q9vKuqNPARD4 (version 25) |
| Access Map artifact (ADR-41 reference) | https://claude.ai/artifact/BYDtci7dm4D4j7ZGcgiyew |
| Redesign canvas (UI principles 1 to 12) | https://claude.ai/artifact/4NA4Sb2hBK3JkngbGUue1p |
| Help, environment state, round controls canvases | https://claude.ai/artifact/5xudtZXATxuEjYMxY8WXGJ, https://claude.ai/artifact/AM7bjEZ8S8pS4s4J4NoPE3, https://claude.ai/artifact/Q9aywNY85o35D791WWrYdW |
| Agent Builder Design canvas | link not recorded in the repo; the Code Owner holds it |

## 1. Agent builder

Ruling state (all in `plan/agent-builder-decisions.md`, on main via #1244 and #1252):
- Q1 to Q12: recorded 2026-11-08.
- Q13 entry and exit, revised 2026-11-12: a parallel screen and mode like Operations, behind the agent flag, with no change to the docked assistant.
  - Entries: "Build with the assistant" on the New form screen (beside "Start blank") and "Edit with the agent builder" in a form's menu. No top bar start screen.
  - Routes `/forms/[formId]/build` and `/forms/new/build`; a new form is created on the first confirmed step; only the open draft is edited; no environment selector.
  - Chrome: top bar group "Agent builder", form name (or "New form") and Exit; no rail, no breadcrumb row; heading row Edit by hand, Share preview, Publish; below 64rem the pane and preview are two tabs.
  - Its own conversation store; the dock does not render in the mode; proposals still run only from an ActionCard.
- Design system (version 88) mirrors Q13: Rail card exception and a README decisions row. The Topbar card does not yet describe the "Agent builder" group.

Next:
1. Work plan in the decisions file: W1 (decision bundle: ADR-19/25/28/30/41 notes, SEC-3/9 check, SEC-17 and agent-principle amendment, new SEC-18, supersede 049 exclusion, panel-width and rail exception), then A1 to A6, U1 to U6, S1, S2.
2. `plan/admin-design-contracts.md` 7.0 table still needs the build-mode exception, and `docs/form-publishing-flow.md` the entry and exit.
3. Add the build screen (desktop, phone tabs, flag off, empty new form) to the Agent Builder canvas; draw the Topbar group in the design system's Topbar card.
4. Fable first review for the SEC-18 theme-derive fetch, per the plan.

## 2. Workspaces area (admin)

Canvas boards: rulings, wording, user-text sweep, rail, promotion, form-selection card, Members (one and three workspaces), Access groups, New access group (open and closed), Audit, Site configuration, Archive, three phone boards, themes. Canvas sources lived in a session scratchpad and are not kept; read the artifact to recover them.

Code Owner rulings (2026-11-08) over the brief:
- Area label "Workspace" at one workspace, "Workspaces" at two or more; at one, the crumb keeps the name, with no All workspaces row, back link or "Workspace: name" line.
- Keep Members, Grant, Revoke. Creation is a level-2 rail row. Audit is one row with Access and Assistant tabs. Archive is its own row at two or more.
- Shared library and Accounts are installation-administrator rows in Site configuration. No Move screen.

Design decisions in the canvas: roles are five checkboxes in two groups (Forms, Responses); Environments and Forms are multi-select; selected forms are always listed in full with an Edit forms drawer; no label field and no Advanced section; primary actions sit in the content heading row.

Design system (version 88): Rail card (Workspace and Site configuration rows, level-2 naming rule), new Members, AccessGroup and Audit cards, decisions rows, one-function-per-control rule. An independent Fable review was done and the clear items fixed.

Open, need a Code Owner ruling:
1. Multi-select roles versus one role per access group (ADR-41, name grammar `<environments>.<role>[.<label>]`): "N groups will be created" with every title shown, or change ADR-41 and the API.
2. Archive rule when a workspace holds forms and there is no Move screen.
3. Level-2 row "New": the review wants the full label for assistive technology and a collapsed rail; the Code Owner said "New" is enough. The Rail card records an accessible-name rule only.
4. Role descriptions: the review wants them visible; the Code Owner said behind `?`.
5. Response eraser danger row: the review wants a word saying why; the Code Owner removed the tag.

Not done: browser verification of the canvas (clipping, alignment, contrast, right-to-left, long unbroken strings); the assistant button in the top bar; nits (`.btn` 13px against the Button card's 14px, some off-scale paddings, phone crumbs, Owner description wording, empty states with two primary buttons). The design assumes API additions: Remove member (last owner refused), and an Audit that shows only what the API records. Implementation tasks are not written yet.

## 3. Other work in flight

- **Untracked in the working tree:** `docs/use-cases/*/source.*` files (PDFs and one HTML) that main did not take; decide whether they belong in the repo or `.gitignore`.
- **Admin UX program:** queue in #1162. #1208 remaining: collapsed rail icon strip, side-sheet detail, plain role names, page header sweep, assistant cards, Erase under More actions, screenshot audit. Also #1207.
- **Decided, not shipped:** help tip, per-environment status, round controls, workspace switcher polish (design system decisions table).
- **Branches and worktrees to triage** (`git branch -vv`, `git worktree list`, then `pnpm worktrees:prune`): the `chore/comments-*` branches and `.claude/worktrees/agent-*` worktrees from the comment sweep, `fix/1239-availability-wording`, `sweep/base`, a detached review worktree, a `codex/dependabot-fixes` worktree. None was touched this session.
- **Deferred by the Code Owner:** triage of the Dependabot alerts on main.
- **Small chores queued:** `plan/environment-navigation-implementation.md` wording ("reserved slot", "edge"); the `.qcms-page-actionbar` magic number.

## 4. Resuming

1. `git fetch`; the branch is level with main now, so rebase again if main moved.
2. Read `plan/agent-builder-decisions.md` and issue #1162.
3. Get the five Workspaces rulings, then record them in the canvas, the design system and a plan file in one pass.
4. Open one chore PR for this handover and any plan edits.
