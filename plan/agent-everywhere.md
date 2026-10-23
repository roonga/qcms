# The agent on every admin screen

**Status:** **ruled 2026-10-19 by the Code Owner; decided, not built.** Written against `origin/main` at `1cd3bdf7`.
**The principle that governs the agent is `docs/agent-principle.md`** (Code Owner, 2026-10-19). This document does not restate it; it implements it. ADR-25 (`docs/adr/admin.md`) records that the decision is governed by that file, and SEC-17 (`docs/SECURITY_DESIGN.md`) is the control.
This document is the working record behind them: the architecture, the screen inventory, the phasing and the test strategy.
**All four phases are launch scope and on the launch gate** (section 1.2).
Sections rewritten after the rulings keep a one-line note of what was recommended before, so a later reader can see what was weighed.

Every claim about current code cites `path:line` at `1cd3bdf7`.
Vendor behaviour is cited from the installed package types (`ai` 7.0.136, `@ai-sdk/anthropic` 4.0.78, `@ai-sdk/openai` 4.0.91, `@ai-sdk/google` 4.0.93, `@ai-sdk/provider` 4.0.26) and from the AI SDK's Anthropic provider page (ai-sdk.dev, "Anthropic", sections "Reasoning", "Thinking Display" and "Thinking Updates", read 2026-10-19).

---

## 1. The rulings

### 1.1 The principle lives in its own file

The Code Owner ruled that the agent principle is recorded **in a separate file, not as part of the ADR**: `docs/agent-principle.md`. Everything below cites its numbered points ("principle point 3") rather than paraphrasing them.
What the file settles, and this design therefore does not reopen:

- **There is no list of permitted or forbidden actions** (principle point 5). An earlier ruling of 2026-10-19 listed five never-proposable classes, and the first draft of this document implemented them as a server-side denylist; the principle, ruled later the same day, explicitly superseded that list and the per-action questions the draft asked (Q3 to Q8). The list is kept here as history only.
- **The agent has the signed-in user's role and permissions** (point 1). For a read-only user it cannot write and does not offer to: write proposals are not offered at all, not offered and then refused (section 6.1).
- **One plan, one Confirm** (point 3). A multi-step request is one plan card listing every step; one Confirm runs the steps in order and stops at the first failure. This supersedes the draft's "at most five cards per turn, no confirm-all" (Q20).
- **Response metadata is allowed; answers are not** (point 4). The metadata point 4 lists may reach the model; answer values, the answer ledger and webhook payloads may not.

The Code Owner also said, in their words: "I think we are micro-managing the agent." Earlier rulings of the same day stand: the drab UX becomes a Confluence/Rovo-style floating launcher and a floating or dockable panel on every admin screen, with visibly streamed responses and visible thinking; and every agent action is shown as a card with Confirm and Cancel.

### 1.2 Scope and the launch gate (Q1, Code Owner, 2026-10-19)

**Phases A, B, C and D are all launch scope and all on the launch gate.**
That moves the cut-line, and it is recorded where cut-line moves are recorded: `docs/PROJECT_GOAL.md` section 5, `docs/IMPLEMENTATION_PLAN.md` stage 8a and the launch-gate exit, and the selection constraints in `docs/features/README.md`, which until now said "041 never gates 038".
**Task 038's launch-gate validation must cover the agent**: the external tester's checklist gains an assisted run in which the tester asks the agent for a change on at least three screens (the builder, the releases screen and a response screen), confirms one single-step card and one multi-step plan, cancels one, signs in as a read-only user and sees no write proposal, and checks that no answer value appears in the conversation. That is goal 7 of `docs/features/038-launch-gate-validation.md`, whose header now depends on phases A to D of this plan (work orders 080 to 083).

### 1.3 Decided defaults (Code Owner delegated, 2026-10-19)

The Code Owner delegated the remaining questions to the conductor's recommended defaults under the principle. They are decided and revisable.

| Was | Decided default                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q2  | The shortcut is **`Alt+Shift+A`** (ruled by the Code Owner directly).                                                                                              |
| Q9  | **No small-count suppression.** Counts are metadata, not answer values.                                                                                            |
| Q10 | **An agent count read writes a SEC-15 `read` row**, so "who looked" includes the agent's looks on a user's behalf.                                                 |
| Q11 | **Staff names and emails may go to the provider.** They are not respondent data.                                                                                   |
| Q12 | **A new append-only `control.agent_actions` table**, readable by whoever can read the existing access audit (workspace owners and the installation administrator). |
| Q13 | **The proposal-token key is derived from an existing key**, with no new variable (section 7.4).                                                                    |
| Q14 | **An in-house safe Markdown subset renderer**, with no new dependency.                                                                                             |
| Q15 | **The conversation lives in memory only.**                                                                                                                         |
| Q16 | **`QCMS_AGENT_THINKING` takes `off` or `summary`, default `off`.**                                                                                                 |
| Q17 | **The project-level wording edits are accepted**, rewritten to cite `docs/agent-principle.md`.                                                                     |
| Q18 | **The launcher appears on every screen, including Settings.**                                                                                                      |
| Q19 | **10 turns per minute per user**, the existing default.                                                                                                            |
| Q20 | Superseded by principle point 3: **one plan, one Confirm** (section 4.10).                                                                                         |

### 1.4 Acts with no admin screen control (Code Owner, 2026-10-20)

**Only acts that have a control on an admin screen are proposable; an act becomes proposable when it gets a screen.**
Some acts a user may perform exist only in the API: the installation administrator creates and archives workspaces and marks the shared one there (`apps/admin/app/(shell)/workspaces/page.tsx` says so in its header comment). Confirm runs a screen's own server action, and these have none, so they have no card until a screen for them is built. This was the last open question of the previous revision.

## 2. Where it stands today

**Text already streams end to end.**
The loop maps each SDK `text-delta` part to an `AssistEvent` of type `text` (`apps/api/src/features/forms/assist/assistant.ts:235-237`).
The handler frames every event as its own SSE frame (`apps/api/src/features/forms/assist/handler.ts:157-159`) and answers with `x-accel-buffering: no` (`handler.ts:234-242`).
The admin BFF route hands the upstream body back unbuffered (`apps/admin/app/(shell)/forms/[formId]/assist/route.ts:66-69`), and the panel accumulates deltas as they arrive (`apps/admin/components/forms/assist-panel.tsx:162-165`).

**A turn still reads as "working", then a burst.** Three reasons, all visible in the code:

- The system prompt tells the model to call `validate_draft`, "then explain your proposal in two or three sentences of plain prose" (`apps/api/src/features/forms/assist/system-prompt.ts:102-103`). Prose comes after every tool call, by instruction.
- A tool step is announced only when the SDK has parsed the **complete** tool call (`assistant.ts:238-249`). `propose_draft` carries a whole `FormDefinition` as its input, so the longest silent stretch of a turn is the model streaming that JSON, during which nothing is emitted. The SDK already exposes a `tool-input-start` part that arrives first (`ai` 7.0.136, `dist/index.d.ts:3203-3209`); the loop drops it in the `default` branch.
- **Provider reasoning is dropped.** `reasoning-start`, `reasoning-delta` and `reasoning-end` parts (`ai` 7.0.136, `dist/index.d.ts:3182-3197`) fall into `handlePart`'s `default: return undefined` (`assistant.ts:263-264`). On newer Anthropic models that matters more than it looks: the provider page states that these models "return progress notes between tool calls as thinking blocks rather than text, so without this setting a long tool-calling turn can look silent", and that under the default `display: 'omitted'` thinking blocks arrive with empty text.

**The provider-options seam exists but is never fed.**
`aiSdkDraftAssistant` accepts `providerOptions` and passes them to `streamText` (`assistant.ts:147-153`, `assistant.ts:337-341`), but `selectDraftAssistant` constructs it without any (`assistant.ts:601-603`).

**The panel mounts in one place.**
`AssistPanel` renders only inside `FormBuilder` (`apps/admin/components/forms/form-builder.tsx:815-822`), and only when the page passes the `assist` prop under `agentAuthoringEnabled()` (`apps/admin/app/(shell)/forms/[formId]/page.tsx:195-197`).

**The panel's chrome is the "drab" the Code Owner named.**
The header is an `<h2>` and a full text button reading "Collapse the assistant panel" (`assist-panel.tsx:204-213`, catalog `apps/admin/lib/i18n/en.ts:1795`), persisted in `localStorage` (`assist-panel.tsx:385`).
Turns are a flat `<ol>` of "You: ..." and "Assistant: ..." lines with the prose as plain text (`assist-panel.tsx:224-245`).
The working indicator is one sentence that names the raw tool identifier, "The assistant is using a tool: {tool}" (`assist-panel.tsx:504-508`, `en.ts:1804`), so an operator reads `propose_draft`.

**The safety properties worth keeping are structural, and this design keeps them.**
One frozen registry and one dispatch door that refuses any name outside the allowlist (`apps/api/src/features/forms/assist/tools.ts:41-55`, `tools.ts:190-215`, `tools.ts:257-265`).
A context object whose shape is the PII boundary (`apps/api/src/features/forms/assist/types.ts:89-100`), pinned by a key-set test.
A loop that ends at the step that reached for an unknown verb (`assistant.ts:301-305`).
A server-run validation over every draft proposal (`assistant.ts:495-509`).
A per-principal rate limit on turns (`apps/api/src/features/forms/assist/route.ts:100-113`, `route.ts:121`).
A flag that gates the mount rather than a handler branch (`route.ts:115-116`; `apps/admin/app/(shell)/forms/[formId]/assist/route.ts:51`).
And the one property that makes the confirm model cheap to reason about: **the turn never executes a mutation**. Today's "Accept" is already a separate human request (`handler.ts:349-451`).

## 3. Goals and non-goals

**Goals.**

- A launcher and panel on every authenticated admin screen, floating by default and dockable, with a full-screen sheet on narrow viewports.
- Responses that visibly stream from the first second of a turn: narration before tools, a live step timeline in plain language, a streaming caret, and an optional thinking disclosure.
- `docs/agent-principle.md`, implemented: every proposal is a card (one action) or a plan card (several, in order); nothing runs without Confirm; Confirm runs the screen's own server action as the signed-in user; a read-only user is offered no write.
- No answer value, answer ledger row or webhook payload in any provider payload, enforced by what the read tools can structurally return, not by a prompt; response metadata flows freely.
- Every confirmed agent action is distinguishable in the audit trail as agent-proposed and human-confirmed.

**Non-goals.**

- **No autonomous execution.** No auto-confirm, no scheduled or background agent runs, and no Confirm that spans more than the one card or plan it sits on. One Confirm runs exactly what that card or plan lists.
- **No agent in the serving path.** The portal, `evaluateRules`, the stored snapshot and the respondent API are untouched (Project Goal section 8).
- **No cross-session memory.** The conversation lives as long as the browser tab's shell does (section 5.3); nothing is stored server-side between turns, as today (`docs/agent-authoring.md:229`).
- **No new provider, no new framework, no new dependency.** The AI SDK stays below the `DraftAssistant` seam (`types.ts:171-177`); the Markdown renderer is in-house (section 4.9).
- **No agent before sign-in.** The sign-in, two-factor challenge and change-password screens sit outside `(shell)`, where there is no signed-in user to act for, and the launcher never mounts there.
- **Not a chatbot product.** The conversation cap (`apps/api/src/features/forms/assist/schema.ts:27`) and the step ceiling stay.

## 4. UX

### 4.1 The launcher

A circular 48 CSS px button, fixed to the inline-end, block-end corner of the viewport, 24 px from both edges, carrying the assistant icon and an accessible name from the catalog ("Open the assistant").
It is rendered once, by a client component mounted in the authenticated shell layout beside the `Announcer` (`apps/admin/app/(shell)/layout.tsx:108-112`), only when `agentAuthoringEnabled()` is true on the server, and on **every** `(shell)` screen, Settings included (Q18).
With the flag off the component is not rendered at all, the same "absent rather than hidden" stance the builder prop takes today (`form-builder.tsx:167-173`).

The launcher hides while the panel is docked (the dock has its own close button) and while the narrow-viewport sheet is open.
It shows a status badge, never colour alone: "Working" while a turn runs with the panel closed, and "1 action to review" when a card is waiting.

### 4.2 Float, dock and sheet

| Mode      | When                                                | Geometry                                                                                                                                                                          | Semantics                                                                                                          |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Float** | default at and above `--bp-sidebar`                 | 400 x 600 CSS px anchored above the launcher; min 320 x 400; max `min(50vw, 560px)` x `calc(100dvh - var(--admin-topbar-measured-h) - 48px)`; resizable from its top-start corner | non-modal `role="dialog"` with `aria-labelledby` on the panel title; focus is not trapped; the page stays operable |
| **Dock**  | user choice at and above `--bp-sidebar`, remembered | a third track of the shell body grid, 400 px wide (320 to 560, resizable), full height below the top bar; the content column narrows rather than being overlaid                   | `<aside>` complementary landmark named by the panel title                                                          |
| **Sheet** | always below `--bp-sidebar`                         | full viewport below the top bar                                                                                                                                                   | modal `role="dialog"` with `aria-modal="true"` and a focus trap, because nothing behind it is reachable            |

The dock is a grid track rather than an overlay because the shell body is already a two-track grid keyed off whether a rail is present (`layout.tsx:184-206`), and a track is the only geometry that cannot obscure page content.
The choice between float and dock is stored in a cookie the layout reads, the way the appearance mode is (`layout.tsx:88`), so a dock renders docked on first paint rather than jumping after hydration.
`plan/admin-mobile-stance.md` decides what "narrow" means for the admin; the sheet follows whatever breakpoint that stance names.

### 4.3 Keyboard

- **`Alt+Shift+A` opens or focuses the panel** (Q2, ruled). It is a modifier chord, so WCAG 2.2 SC 2.1.4 does not bind it; it avoids the CodeMirror JSON pane's `Ctrl+/`; it is not captured while a text input outside the panel has focus. It is printed in the launcher's tooltip and the panel's help.
- **Escape** closes the float panel and the sheet and returns focus to the element that had it before the panel opened. In the dock, Escape moves focus back to the page without closing the dock. If a card's confirmation is mid-flight, Escape first cancels that card, never the turn.
- **Stop** is a button in the composer while a turn runs; it aborts the request, which aborts the upstream call as today (`handler.ts:226-230`, `handler.ts:194-196`).
- **Enter** sends; **Shift+Enter** is a newline. The composer is a multi-line text area, not the single-line `TextField` used today (`assist-panel.tsx:355-365`).

### 4.4 Focus management

- Opening moves focus to the composer. Closing returns it as above.
- A turn ending does not move focus. A **card arriving** moves focus to the card's heading only when focus was already inside the panel; today's panel moves it unconditionally (`assist-panel.tsx:104-106`), which would yank a docked user out of the page.
- After Confirm or Cancel, focus moves to the card's result line (Confirmed, Cancelled, Failed), which stays in the conversation as a record.
- Navigation between screens keeps the panel open and never steals focus.

### 4.5 WCAG 2.2 AA

- **2.4.11 Focus Not Obscured (Minimum).** The launcher and the float panel are fixed-position author content and can sit over a focused control. The shell already solves this class for the sticky top bar by measuring it and publishing a scroll padding (`layout.tsx:113-120`, `apps/admin/app/globals.css:342`), and a sticky footer once did the same at the block end (`globals.css:2343-2348`). The launcher and the float panel publish their own rectangles the same way, as `scroll-padding-block-end` and `scroll-padding-inline-end`, so the browser scrolls a newly focused control clear of them. The dock needs nothing, because it is a grid track. The Playwright suite asserts the criterion directly, the way `repeat-table.pw.ts` does (`docs/features/077-table-presentation.md:23`): with the panel floating, tab through each screen's controls and assert none is wholly covered.
- **2.5.8 Target Size (Minimum).** Every icon button is at least 24 x 24 CSS px; the launcher is 48.
- **1.4.10 Reflow.** At 320 CSS px the panel is the sheet; no horizontal scrolling except inside a code block.
- **1.4.13 Content on Hover or Focus.** The launcher tooltip is dismissible with Escape, hoverable and persistent.
- **4.1.3 Status Messages.** Streaming prose is **not** announced token by token. The panel's polite live region announces phase changes in plain language ("Searching the question library", "1 action to review") and one completion line per turn. The in-progress bubble carries `aria-busy="true"` until its segment ends. Announcements that must survive a route change go through the shell's `Announcer` (`layout.tsx:108-112`).
- **1.4.1 Use of Color.** Card kinds, step states and the "agent proposed" marker carry text and an icon, never colour alone, as the current diff lines do (`assist-panel.tsx:573-579`).
- **Contrast** follows the admin theme tokens, including the high-contrast dark theme (`plan/high-contrast-dark-plan.md`).

### 4.6 Reduced motion

Under `prefers-reduced-motion: reduce`: no slide, scale or fade on open and close; the streaming caret is a static bar; the thinking indicator has no shimmer; the timeline's running state is an icon, not a spinner.

### 4.7 Internationalisation

Every string is a catalog key in `apps/admin/lib/i18n/en.ts` under a new `agent.*` namespace (ADR-27): every tool's plain-language label, every card title template, every consequence line and every error.
**Card titles are rendered by the admin from the card's structured arguments and a catalog template, never from model text** (section 4.10).
Times use `Intl` through `apps/admin/lib/i18n/format.ts`.
The model's own prose is whatever language it writes; nothing in the UI depends on that prose.

### 4.8 Header

One compact row, 44 px tall: the title ("Assistant"), a context chip naming what the agent can see on this screen ("Form: Vehicle quote, draft"), then four icon buttons with catalog names and tooltips: **New conversation**, **Dock** or **Float** (a toggle with `aria-pressed`), **Help**, **Close**.
The present text button (`assist-panel.tsx:208-212`) goes; collapse is replaced by close, since the launcher reopens.

### 4.9 Conversation

- **Bubbles.** User turns right-aligned in a filled bubble; assistant turns left-aligned, full width, unfilled, with a small avatar. Each assistant turn is a column of **segments** in arrival order: prose, a step timeline, a thinking disclosure, cards.
- **Markdown through an in-house safe subset (Q14).** A small renderer in `apps/admin/lib/agent/markdown.tsx` that parses a closed subset (paragraphs, line breaks, emphasis, strong, inline code, fenced code, ordered and unordered lists, headings mapped to bold paragraphs, and links) into React elements, so it **cannot emit raw HTML** because it never builds HTML from strings. **No images**: an image is the classic exfiltration channel, a URL the browser fetches without a click. Links render as links only when they are same-origin relative paths into the admin (`/forms/...`), and as plain text otherwise. Anything outside the subset renders as literal text. The admin CSP already limits `img-src` to `'self' data:` and `connect-src` to `'self'` (`apps/admin/lib/server/csp.ts:46`, `csp.ts:49`), which is defence in depth here. The renderer gets its own unit tests, including hostile inputs (HTML tags, `javascript:` links, image syntax, reference-style links, nested emphasis bombs).
- **Streaming caret** after the last character of the segment currently streaming; it disappears on `text-end` (`ai` 7.0.136 `dist/index.d.ts:3177-3181`) or turn end.
- **Step timeline.** One row per tool step: an icon, a plain-language label from the catalog, and a state (running, done, failed). Read tools read "Reading {what}", propose tools "Preparing an action for you to confirm". A failed step the model then corrected (today's `toolErrors`, `assistant.ts:220-223`) shows as failed then done. The row appears on `tool-input-start`, not on the parsed call (section 9).
- **Thinking disclosure.** When the operator setting allows it (section 8), a collapsed `<details>` labelled "Thinking", with a running indicator while reasoning streams and "Thought for {n} s" afterwards. Its contents render as plain text, never Markdown.

### 4.10 Cards and plans

_Recommended before the rulings: one card per action, at most five per turn, no confirm-all. Ruled (principle point 3): one plan, one Confirm._

A card is the only way an agent action reaches a human, and the only place Confirm exists.
A single action is shown as a **card**; a request that takes several actions is shown as one **plan card** (ruled, principle point 3). **Ruled (P1, Code Owner, 2026-10-24):** a turn ends with at most one proposal, a card or a plan.
Because the principle makes every action the user can take proposable, **the card carries the weight a denylist would otherwise have carried**, and four rules make it carry it.

```
+------------------------------------------------------+
| (icon) Release version 3 to prod           Proposed  |
|  [ Production ]  This changes what respondents get.   |  <- catalog consequence band
|  Form: Vehicle quote                                  |
|  Environment: prod   Replaces: version 2              |
|  "Version 3 adds the at-fault accident branch."       |  <- model's reason, quoted, plain text
|                                                      |
|  [ Confirm ]   [ Cancel ]   Open the Releases screen  |
+------------------------------------------------------+

+------------------------------------------------------+
| (icon) Plan: 3 steps                       Proposed  |
|  1. Publish the draft of Vehicle quote                |
|  2. Release the version step 1 publishes to test      |
|  3. Mint 20 one-time links in test, expiring 30 Nov   |
|  "Gets the new branch in front of the pilot group."   |
|                                                      |
|  [ Confirm all 3 steps ]   [ Cancel ]                 |
+------------------------------------------------------+
```

1. **The admin writes the card, the model does not.** Title, consequence band and argument lines come from each action's kind, its structured arguments and catalog templates, using the same consequence sentences the screen's own confirmation dialog uses. The model's free text appears only as a visibly quoted "reason" line in plain text. A model cannot label a step "Release to test" while its arguments say `prod`, and cannot hide a consequence the screen's dialog would state.
2. **Every step and every argument is displayed.** A plan lists every step in the order it will run, each with every argument in full: a webhook URL including its query string, an environment, a member and the role they will get, an erasure's reason, an export's filters. A step that uses an earlier step's result says so in words ("the version step 1 publishes"). Nothing an injected instruction can choose is left off the card, and no step is collapsed or summarised away.
3. **A card is never a weaker confirmation than the screen's own dialog.** Where a screen's control requires more than one press, the card requires the same for that step: erasure needs the typed confirmation its dialog asks for (`apps/admin/app/(shell)/responses/actions.ts:15-18`), entered on the card before Confirm; a production act shows the production band; the API's own two-person rule for production (ADR-40, task 070) applies unchanged. Actions whose arguments include a **secret the user must type** (a current or new password, a TOTP code) are **hand-off steps**: Confirm opens the screen's own control with focus in its first field and the non-secret arguments filled, and the user types the secret there, so it never passes through the conversation. A hand-off step may only be the last step of a plan.
4. **One plan, one Confirm.** Confirm runs the listed steps in order, each through its screen's own server action as the user (section 6.4). The run **stops at the first failure** and the card reports, per step, Done, Failed (with the action's own error message) or Not run. There is no Confirm that reaches beyond the card it sits on.

Further:

- **Progress is visible.** During a plan run each step row shows running, done or failed as it happens, announced through the panel's live region.
- **Revealed secrets go to the user, never the model.** Creating a webhook endpoint or rotating its secret, regenerating recovery codes, and minting links each return a value shown once; the card displays it exactly as the screen does, and the next turn learns only that it happened (section 7.6).
- **Cancel** marks the card or plan cancelled locally and tells the next turn. Nothing is sent to the server. A plan cannot be cancelled halfway through a step; Stop during a run lets the running step finish and runs no further step.
- **Open the screen** links to the screen whose control a single-action card mirrors. Cards are not editable: an edited argument is a different proposal, and the token binds the arguments (section 7.4).
- **Expiry.** A card or plan older than its token's lifetime (ten minutes, measured to Confirm) shows "Expired - ask again" and its Confirm is disabled.
- **Size. Ruled (P2, Code Owner, 2026-10-24):** a plan carries at most 25 steps, a payload bound in the spirit of the conversation cap (`schema.ts:27`) rather than a permission rule.
- **The draft proposal is a card too.** Today's proposal panel (diff, issues, warnings, Accept, Discard; `assist-panel.tsx:254-353`) becomes the `apply-draft` kind with the same diff and the same two advisory lists; its Accept already runs through the builder's own save (`assist-panel.tsx:184-189`, `form-builder.tsx:820`). It can also be the first step of a plan ("apply this draft, then publish it").

## 5. Context model

### 5.1 How a screen exposes its context

The browser never sends context content.
It sends a **screen id** and the route's object ids, and the API builds the context itself, under the caller's grants, so a tampered client cannot hand the model something the screen would not show.

- **Admin side.** A typed table, `apps/admin/lib/agent/screens.ts`, maps each `(shell)` route pattern to a screen id (the ids in section 12). The launcher sends `{ screen, params }` with each turn. A test reads the route tree off the filesystem and fails when a `(shell)` page has no row, the pattern `lib/rail-routes.test.ts` uses for the rail slot (`layout.tsx:61-71`).
- **API side.** A frozen `SCREENS` registry, keyed by screen id, holds for each screen: a context builder, its read tools, and its action kinds. The context builder returns a **typed facts object** with a strict Zod schema: what the screen displays, **minus any respondent answer value**. The selected environment comes from the same environment switcher (task 065, `docs/features/065-release-records.md`) header every other admin request carries.

The current `AssistContext` (`types.ts:89-100`) becomes the builder screen's context. Its key-set test stays, and every new screen context gets one.

### 5.2 Allowed tools per screen

A turn's tool set is the intersection of the global frozen registry and the current screen's list.
The single door refuses any name outside **the current screen's** list (section 6.2). This is not an action limit (principle point 5: the user's own permissions are the list); it keeps each turn's tool list small and each proposal's kinds attached to the screens whose controls they mirror. A plan may include steps of other screens' kinds when the request needs them (publish on the builder, then release), because the screen list scopes which **read** tools a turn sees and which kinds it offers first, and the plan tool accepts any kind whose step passes the grant filter of section 6.1.

### 5.3 Conversation continuity

- **Within a form's subtree, one conversation.** Builder, Rules, Preview, Versions, Releases, Links, Webhooks and Responses for the same `formId` share one conversation, held in a React context the shell layout provides, which persists across soft navigations within `(shell)`. Each turn carries the current screen id, and the API prepends "The user is now on the Releases screen of this form" to that turn.
- **Leaving the form starts a new conversation**, keyed by the new subject; returning within the tab restores the old one.
- **Memory only (Q15).** Nothing is written to `localStorage` or `sessionStorage`: sign-out is a form post (`layout.tsx:35-40`) that does not clear tab storage, so a shared workstation would show the next user the last user's conversation. A reload starts fresh.
- **Card outcomes join the history** as a structured `action-result` turn with a closed schema: kind, outcome, and allowlisted non-secret result fields (section 7.6). The request schema's turn shape (`schema.ts:15-18`) gains this variant.

### 5.4 Screens with nothing to propose

A screen whose controls are navigation only (the responses form picker) still opens the panel; the context chip says what the agent can see, and the empty state offers explanation and navigation.

## 6. Action and tool architecture

_Recommended before the rulings: a three-point server-side denylist over five classes, and one card per action. Ruled (`docs/agent-principle.md`): no list; the user's own permissions are the list; one plan, one Confirm._

### 6.1 Two kinds of tool, filtered by the user's grants

- **Read tools** return what the screen displays, minus answers (section 10). Each declares the SEC-3 matrix cell it needs, and the door checks that cell for the calling principal with the same policy evaluator the route middleware uses (`apps/api/src/features/membership/route-policy.ts`), before running. A read that the matching screen would audit is audited the same way (a response count writes a SEC-15 `read` row, Q10).
- **Propose tools.** `propose_action` takes one action; `propose_plan` takes an ordered list of steps, each an action kind with its arguments, where an argument may be a **reference** to a field of an earlier step's result (`{ fromStep: 1, field: "version" }`). Each action kind's argument schema is the action's own. A propose tool **never executes anything**. It validates every step's arguments, checks each step against the caller's grants with the same policy evaluator, and on success records the proposal in the turn's state, emits it at once as an `action` or `plan` SSE event, and returns `{ proposed: true, proposalId }` to the model. A failed check returns the reason to the model; it is not a turn-ending refusal. Under P1 (ruled, section 16), a second proposal in one turn is refused with "one proposal per turn; put the steps in one plan".
- **Same role, same permissions (principle point 1).** The action kinds offered to the model in a turn are **filtered by the caller's grants before the turn starts**: a kind whose matrix cell the user does not hold in the current environment is not in the tool's schema at all, so a read-only user's turn is offered read tools and no action kind, and the system prompt says so ("this user cannot change anything here; explain and navigate"). The filter is a courtesy that keeps proposals honest; **the API's own authorisation at execution is the limit**, and a step the filter missed (a grant revoked mid-conversation) fails at its own route.

The turn-ending refusal stays where it is: a call to a tool name that does not exist ends the turn at that step with no proposal (`assistant.ts:247-251`, `assistant.ts:301-305`, `assistant.ts:447-460`).

### 6.2 The registry stays module-private and frozen, with one door

```
features/agent/                      (grown out of features/forms/assist)
  tools/registry.ts     TOOLS: frozen Record<ToolName, ToolDef>; runAgentTool(name, input, ctx, state) is the only executor
  tools/read/*.ts       one module per read tool, each a closure over named query helpers
  actions/*.ts          one module per action kind; each exports its ActionKind descriptor
  screens.ts            SCREENS: frozen Record<ScreenId, ScreenDef>
  proposal-token.ts     sign and verify (SEC-7 purpose "agent-proposal")
  provenance.ts         the API middleware that verifies a token on an incoming action request
```

`runAgentTool` refuses a name outside the current screen's list before dispatch, as `runAssistTool` does today (`tools.ts:257-265`); the provider tool set is built from the same list (`tools.ts:272-283`).
Each `ActionKind` descriptor names its API route, its matrix cell, its argument schema, how to recompute its arguments from a request (for the token check), which result fields later steps may reference, its card template keys, whether it is a hand-off step, and its result allowlist.

### 6.3 The three server-side guarantees

1. **Nothing runs without a Confirm bound to a signed proposal token.** The turn holds no executor; an action runs only as a separate request from the user's browser, carrying a token the API verifies against the user, the ordered step list, each step's arguments and the environment (section 7.4). A bad token never degrades to an ordinary human act: it is refused.
2. **The agent's read tools are structurally incapable of returning answer values, the answer ledger or webhook payloads.** No read tool or context builder takes a database handle; each closes over named query helpers whose return types carry none of them (section 10).
3. **The user's own authorisation is the only action limit.** Every step goes through SEC-3's route policy exactly as the screen's control does (`docs/SECURITY_DESIGN.md:248-250`), including ADR-41's role families, the self-grant rule and ADR-40's production approval. The agent adds no right and the design adds no second list.

### 6.4 What Confirm does

For each step, in order, Confirm calls **that step's screen's own exported server action**, imported by the card component, with the step's arguments and one trailing argument, `{ agentProposal: token, step: i }`.
That is the same function the screen's control calls, with the same `requireAdminSession()` gate (`apps/admin/app/(shell)/forms/actions.ts:65-70`), the same Next origin check, the same API route, the same authorisation and the same revalidation.
The only change to each server action is that it forwards the token and step index as `X-QCMS-Agent-Proposal` and `X-QCMS-Agent-Step` headers, which is proxying (R2).
A step whose arguments reference an earlier step's result is sent with the reference resolved by the card from that step's returned state; the API checks the resolved value against what it recorded for the earlier step (section 7.4), so the browser cannot substitute a different value.
The card waits for each step's result before sending the next, and stops at the first failure: an action's error state, a refused token, or a network error. It never retries a step.
Actions that take a `FormData` from `useActionState` (`apps/admin/app/(shell)/questions/actions.ts:101-124`, `questions/actions.ts:160-163`) get the same `FormData` the screen's form would post.
The settings screen's password and recovery-code posts are route handlers rather than server actions (`apps/admin/app/(shell)/settings/password/route.ts`, `settings/recovery-codes/route.ts`), and both need a secret, so they are hand-off steps (section 4.10 rule 3) and never carry a token.

Client-driven sequencing is chosen over a server-side plan executor because it keeps every step on the screen's own server action and audit trail, as the principle requires, and adds no new execution path in the API. The server still enforces order (section 7.4).

### 6.5 The agent can never exceed the user

- The turn holds no executor for any mutation; proposing is not executing.
- Each step is an ordinary request under the user's own admin session, authorised by the API's route policy.
- The token is bound to the user who received it, so it cannot be carried to another session.
- Action kinds are offered only where the user holds the cell; read tools check the caller's own cells, so the agent reads nothing the screen would not show this user.

### 6.6 Audit

Each step's existing trail is written exactly as if the user had pressed the screen's own button: the release record names the user (ADR-40), an export or erasure writes its SEC-15 row (`docs/SECURITY_DESIGN.md:677-680`), a grant writes its SEC-15 `grant` row, a draft accept sets the sticky `agentAssisted` mark (`handler.ts:419`).

**In addition**, every confirmed agent step writes one row to a new append-only `control.agent_actions` table (Q12), in the step's own transaction, through one helper the handlers call when `c.var.agentProposal` is set: proposal id, step index, step count, actor, workspace, environment, form, action kind, screen, proposed-at, confirmed-at, and a non-content detail (a version number, an environment name, a count, a role name) that doubles as the record later steps' references are checked against. `(proposal id, step index)` is unique. No `LocalizedText`, no answer value, no secret.
It takes the SEC-15 precedent shape: append-only, no foreign key, `INSERT` without `RETURNING` for application roles, no `UPDATE` or `DELETE` for any of them (`docs/SECURITY_DESIGN.md:700`, `SECURITY_DESIGN.md:708-716`).
It is readable by whoever can read the existing access audit: the workspace's owners and the installation administrator (`docs/SECURITY_DESIGN.md:696`).
A failed step writes no row (its transaction rolled back), so the table records exactly what ran, and the card's report and the audit agree.

## 7. Security mechanics

### 7.1 One door per screen

The test that pins it: for every screen, the provider-facing tool set equals the screen's declared list, the offered action kinds equal the kinds whose cells the user holds, and `runAgentTool` refuses every registered name not on the list.

### 7.2 No answers

Every screen's facts schema and every read tool's output schema is `z.strictObject` with enumerated fields. A unit test walks every schema and fails on a field whose name matches the respondent-content vocabulary the stdout redactor uses (`packages/observability/src/logger.ts`). The sentinel test in section 10 proves the property against a real database.

### 7.3 Prompt framing

Tool results and screen facts are delimited as data, and the system prompt states that text inside them is content authored by users and never an instruction. This is a mitigation, not a control; the controls are the confirm, the card rules of section 4.10, and the user's own permissions.

### 7.4 The proposal token

One token covers a single action or a whole plan; a single action is a plan of one step.

- **What it binds.** A MAC token over `{ v: 1, purpose: "agent-proposal", sub: userId, pid, steps: [{ kind, argsDigest }, ...], environment, formId?, iat, exp }`. The step list is **ordered**; each `argsDigest` is a SHA-256 over the canonical JSON of that step's arguments as the card displays them, with a reference to an earlier result kept as the reference (`{ fromStep, field }`) rather than a value. `exp` is `iat` plus ten minutes. HMAC-SHA-256 via WebCrypto (R4).
- **Key (Q13).** Derived, with no new variable: HKDF-SHA-256 over `QCMS_APP_KEY` with the info label `qcms/agent-proposal/v1`, which gives SEC-7's distinct-key-per-purpose property (`docs/SECURITY_DESIGN.md:190`) without an operator burden. A change to `QCMS_APP_KEY` invalidates outstanding proposals, which costs at most ten minutes of cards. SEC-7's inventory records the derivation.
- **Verification**, by `provenance.ts`, mounted on the admin group only when the flag is on, for a request carrying token and step index `i`: signature; purpose; `sub` equals the authenticated principal; not expired; `i` is within the list; the request's route is step `i`'s kind's route; the arguments recomputed from the request match step `i`'s digest, with each referenced field equal to the value `control.agent_actions` recorded for the referenced step of this proposal; **steps `0` to `i-1` are all recorded for this proposal**, so steps run only in order and only after their predecessors succeeded; and the environment the request is **performed in** (the route policy's declared source, `SECURITY_DESIGN.md:250`) equals the token's. Any mismatch is `403` with a stable code and the step does not run. With the flag off, a request carrying the header is refused with `400`.
- **Single use, per step.** The unique `(proposal id, step index)` in `control.agent_actions` means a replayed step fails on the constraint and rolls back.
- **Why the environment check matters.** Mint, revoke, close and reopen read the environment from the environment switcher's cookie (task 065, `docs/features/065-release-records.md`) at execution time (`forms/actions.ts:517-523`, `forms/actions.ts:564-571`). A plan proposed while the switcher said `test` must not run against `prod` because the user switched before pressing Confirm.

### 7.5 Card rendering

Section 4.10's four rules.

### 7.6 Result redaction

What an executed step returns to the screen and what the next turn tells the model are different things.
The `action-result` turn carries an allowlisted summary per step: "minted 20 links, expiring 2026-11-30" and never the URLs, which are bearer credentials (`forms/actions.ts:543-550`); "rotated the endpoint's secret" and never the secret (`apps/admin/app/(shell)/webhooks/actions.ts:21-28`); "regenerated recovery codes" and never a code; "export started, CSV long, version 3" and never a byte of the file; and for a plan, which steps ran, which failed and which did not run. The allowlist lives in each kind's descriptor and is tested.

## 8. Thinking

- **Operator setting (Q16).** `QCMS_AGENT_THINKING`, values `off` (default) and `summary`, typed and fail-fast like `QCMS_AGENT_MAX_STEPS` (`docs/agent-authoring.md:27`), read by the API only. It is configuration, not a feature flag, and the admin never learns its value: the disclosure renders when reasoning events arrive, which keeps ADR-24's "clients receive behavior, not flag values" intact.
- **Vendor-neutral through `providerOptions`.** One function maps the setting to the provider's options and feeds the seam that exists and is unused today (`assistant.ts:147-153`, `assistant.ts:601-603`):

  | Provider            | `summary` maps to                                                                                                    | Source                                                                                                     |
  | ------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
  | `anthropic`         | `thinking: { type: "adaptive", display: "summarized" }`, or `display: "updates"` on models that support it           | `@ai-sdk/anthropic` 4.0.78 `dist/index.d.ts:252-271`; provider page "Thinking Display", "Thinking Updates" |
  | `openai`            | `reasoningSummary: "auto"`                                                                                           | `@ai-sdk/openai` 4.0.91 `dist/index.d.ts:1573`                                                             |
  | `google`            | `thinkingConfig: { includeThoughts: true }`                                                                          | `@ai-sdk/google` 4.0.93 `dist/index.d.ts:19-21`                                                            |
  | `openai-compatible` | nothing requested; whatever reasoning parts the endpoint emits are forwarded under `summary` and dropped under `off` | the SDK surfaces them as `reasoning-delta` parts                                                           |
  | `fake`              | scripted reasoning parts                                                                                             | `apps/api/src/features/forms/assist/fake-model.ts`                                                         |

  The SDK's top-level `reasoning` call option (`@ai-sdk/provider` 4.0.26 `dist/index.d.ts:1545`) sets effort, not visibility, and stays at the provider default.

- **Its own SSE event.** `handlePart` maps `reasoning-delta` to `{ type: "reasoning", delta }` and `reasoning-end` to `{ type: "reasoning-end" }` when the setting is `summary`, and to nothing when it is `off`, **even if a provider emits reasoning unasked**. The admin's mirrored event union (`apps/admin/lib/forms/assist-stream.ts:64-75`) gains both; its parser already skips unknown variants (`assist-stream.ts:144-166`).
- **Never logged, stored or replayed beyond what the provider requires (SEC-8).** No reasoning text reaches a logger, a span, the audit table or the conversation history; the per-turn log line gains only the provider's reasoning token count (`assistant.ts:426-438`). The replayed conversation carries text turns only (`schema.ts:15-18`). Within one turn the SDK carries reasoning blocks between steps in memory, because Anthropic requires them sent back unchanged on the next step of a tool loop (provider page, "Between-Tools Thinking"); that is the only replay.
- **Cost.** Reasoning tokens are billed output; the step ceiling bounds them per turn and the per-principal limit bounds turns.

## 9. Streaming improvements

1. **Announce a step when its input starts.** Map `tool-input-start` to a `status` event with the tool name and a step id (`assistant.ts:238-249`; `ai` 7.0.136 `dist/index.d.ts:3203-3209`). An unknown name emits nothing, and the refusal is still recorded off the parsed `tool-call` (`assistant.ts:250`).
2. **Narrate before tools.** Change the prompt's working order (`system-prompt.ts:95-103`) to: one sentence on what you are about to do; tools, with a short note when the plan changes; then the explanation. Bump `SYSTEM_PROMPT_VERSION` (`system-prompt.ts:32`).
3. **Keep text segments.** Today every delta is folded into one `rationale` (`assistant.ts:236`). Carry the SDK's text segment ids through as `{ type: "text", delta, segment }`, so prose segments interleave with timeline rows; the draft card's `rationale` becomes the last segment.
4. **Heartbeat.** An SSE comment line every 15 seconds during silent stretches, so an ingress idle timeout does not cut a turn. The admin parser already skips frames with no `data:` line (`assist-stream.ts:124-129`).
5. **No transform on the BFF hop.** The BFF forwards only `content-type` and `retry-after` and adds `cache-control: no-store` (`apps/admin/app/(shell)/forms/[formId]/assist/route.ts:93-101`). Add `no-transform` and `x-accel-buffering: no` there too; the API already sets the latter (`handler.ts:240`).
6. **Usage stays off-screen.** Token counts remain logging only (`assist-panel.tsx:57-58`).

## 10. Respondent responses

Principle point 4, made structural. _Recommended before the rulings: counts and structure only, no session ids. Ruled: response metadata is allowed; answers are not._

**What never reaches the model:** answer values, the answer ledger (any row of `answers`, including a retraction's tombstone of a value), and webhook payloads, whose `answers` member carries answers.

**What may:** the response metadata `docs/agent-principle.md` point 4 lists, and only that file's list (this design does not keep a copy). Beyond responses, everything else a screen shows the user may go too: structure, configuration, staff names and emails (Q11), link and release records.

- **No read tool reads an answer.** Context builders and read tools are closures over named query helpers, the property `types.ts:78-88` states for today's two ports. The response read tools close over a **metadata projection** of the response list and detail queries that selects no answer column and joins no answer table, so there is no field for an answer to arrive in. A read the screen audits is audited the same way: the response list read writes the SEC-15 `read` row the screen's own read writes (Q10).
- **Finding a submission is metadata.** The response list's filters are `version`, `from`, `to` and `flagged` (`apps/admin/lib/ops/response-filters.ts:58`), and none takes an answer value; with session ids, times, access type and flag reason the agent can find "the flagged secure-link submission from Tuesday" and propose erasing or unflagging it without reading what the respondent said. Counts are not suppressed at small sizes (Q9).
- **Export is a setting, not a read.** The export card carries format, shape, version and filters (`apps/admin/lib/ops/export.ts:33-60`); Confirm triggers the existing streaming download route in the user's browser, which writes its own SEC-15 export row. Not one byte of the file reaches the agent code or the provider.
- **Webhook payloads and consumer responses never enter context.** A payload's `answers` member is answers, and a consumer's response body or a last-error string may quote one. The webhook screens give delivery status: state, attempt counts, HTTP status codes, times, and endpoint configuration (the whole URL, for a user who may see it, per Q58, `docs/SECURITY_DESIGN.md:309`).
- **Proved against a real database.** `assist.integration.test.ts`'s sentinel test (`apps/api/src/features/forms/assist/README.md:59-62`) generalises: with a submitted answer carrying a sentinel in the database, and a webhook delivery whose payload carries it, the fake provider calls every read tool of every screen, the exact provider payload bytes are captured, and the sentinel is asserted present in the database before it is asserted absent from the payload. The same run asserts that the session id **is** present, so the metadata half of the rule is pinned too.

## 11. Security analysis

Making every user action proposable, and letting one Confirm run a plan, raises the stakes of prompt injection: an injected instruction can now aim at a production release, an erasure, a grant or a webhook target, and can try to hide one of them inside an otherwise plausible plan. The mitigation is not a list of forbidden acts; it is that **a human sees every step that will run, in order, in words the admin wrote, with every argument in full, and presses Confirm knowing exactly what it covers; and no step can do anything the human could not do by hand**.

| Threat                                                                                                                                                       | Mitigations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Controls              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Prompt injection via authored content** (form and question titles, option labels, a shared workspace's questions, staff names) steering a harmful proposal | Nothing runs without Confirm (6.3); titles, consequence bands and argument lines are rendered by the admin from structured arguments and the catalog, so an injected label cannot misdescribe a step; every step and every argument is displayed in full, so an attacker's URL, member, environment or extra step is visible; a card is never weaker than the screen's dialog (typed confirmation for erasure on the card, production band, two-person rule); one proposal per turn (P1, ruled); object ids bound from the route (`tools.ts:161-168` is today's shape); data framed as data (7.3) | SEC-17, SEC-3, SEC-9  |
| **A harmful step buried in a long plan**                                                                                                                     | Every step listed in order with nothing collapsed; per-step consequence bands (a production or erasure step carries its band inside the plan); a plan containing an erasure cannot be confirmed until that step's typed confirmation is entered; the 25-step payload bound (P2, ruled)                                                                                                                                                                                                                                                                                                            | SEC-17                |
| **Prompt injection via webhook payloads or consumer responses**                                                                                              | Never in context (10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | SEC-17, SEC-6, SEC-8  |
| **Confused deputy**                                                                                                                                          | The turn has no executor; each step is an ordinary request under the user's session; the token is bound to the user, the ordered steps, their arguments and the environment; route policy unchanged (6.3, 7.4)                                                                                                                                                                                                                                                                                                                                                                                    | SEC-3, SEC-17         |
| **A read-only user induced to write**                                                                                                                        | No action kind is offered without the user's cell (6.1); any step that slips through fails at its own route (6.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | SEC-3, SEC-17         |
| **Answer exfiltration to the provider**                                                                                                                      | Read tools structurally incapable of returning answers, the ledger or payloads; strict schemas and a vocabulary test; sentinel test per screen (7.2, 10); thinking never logged (8)                                                                                                                                                                                                                                                                                                                                                                                                               | SEC-17, SEC-8, SEC-13 |
| **Secret exfiltration to the provider** (webhook secrets, recovery codes, link tokens, passwords)                                                            | Hand-off steps for typed secrets; revealed secrets shown to the user and never in the next turn (4.10, 7.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | SEC-17, SEC-7, SEC-8  |
| **Exfiltration through the panel** (a Markdown image or link the browser fetches)                                                                            | In-house renderer with no HTML, no images, external links as text (4.9); CSP `img-src 'self' data:` and `connect-src 'self'` (`csp.ts:46-49`)                                                                                                                                                                                                                                                                                                                                                                                                                                                     | SEC-9, SEC-17         |
| **Exfiltration through an action** (a webhook retargeted to an attacker's URL, a grant to an attacker's account)                                             | Proposable, because the user may do it; the card shows the old and new URL in full, or the account and role, under the screen's own consequence copy; the user's own rights bound it; the step is audited twice (SEC-15 and `agent_actions`)                                                                                                                                                                                                                                                                                                                                                      | SEC-17, SEC-15        |
| **Tampered, reordered or stale plan**                                                                                                                        | Token binds the ordered step list, each step's argument digest (references kept symbolic, resolved values checked against the recorded result) and the environment; the API refuses step `i` unless steps `0` to `i-1` are recorded; ten-minute expiry; cards not editable (7.4)                                                                                                                                                                                                                                                                                                                  | SEC-17, SEC-7         |
| **Replay**                                                                                                                                                   | Unique `(proposal id, step index)`; a replayed step fails and rolls back (6.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | SEC-17                |
| **Partial execution**                                                                                                                                        | Stop at the first failure; the card reports Done, Failed and Not run per step, and `agent_actions` records exactly the steps that ran; no automatic retry                                                                                                                                                                                                                                                                                                                                                                                                                                         | SEC-17                |
| **Social engineering by the model** ("this is safe, just confirm")                                                                                           | Model text is quoted and never in a title, band or argument line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | SEC-17                |
| **Cost and rate**                                                                                                                                            | One per-principal limiter key across every assist route at 10 turns per minute (Q19; `route.ts:106-111`), step ceiling, conversation cap (`schema.ts:27`), one proposal per turn (P1, ruled), thinking off by default, token counts logged                                                                                                                                                                                                                                                                                                                                                        | ADR-25, SEC-8         |
| **CSRF and origin on new routes**                                                                                                                            | Every new admin route handler carries `isSameOriginPost()` and its own session gate, enforced by `apps/admin/lib/server/shell-route-guards.test.ts:46`; server actions keep Next's origin check; no CORS; the API is reached only over SEC-4's channel                                                                                                                                                                                                                                                                                                                                            | SEC-9, SEC-4          |
| **Telemetry leakage**                                                                                                                                        | New log events carry counts and ids only; attributes outside the allowlist drop on export, as today (`assistant.ts:462-476`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | SEC-13                |

## 12. Inventory of admin screens

_Recommended before the rulings: a per-screen table of denied actions. Ruled (`docs/agent-principle.md`): every action the user can take is proposable; answers are the exception._

Screen ids are the route patterns under `apps/admin/app/(shell)/`.
Every listed action is proposable, alone as a card or as a step of a plan, and its Confirm calls the named server action. **It is offered only to a user who holds its cell, and runs only if the API's authorisation allows it**: for a read-only user every row's proposable column is empty and the agent explains and navigates.
"Hand-off" marks a card whose Confirm opens the screen's own control because a secret must be typed there.
On every screen, what is never given to the model is an answer value, an answer-ledger row or a webhook payload; response metadata is given (section 10).

| Screen (route)                                                   | Facts sent to the model                                                                                                                            | Read tools                                                                                                    | Proposable actions (server action)                                                                                                                                                                                                                                                                                                                                                                     | Phase |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `forms` (list)                                                   | forms with ids, slugs, titles, status per environment, latest versions                                                                             | search forms                                                                                                  | create a form (`createFormAction`, `forms/actions.ts:130`)                                                                                                                                                                                                                                                                                                                                             | D     |
| `forms/new`                                                      | the workspaces the user may create in                                                                                                              | none                                                                                                          | create a form (`createFormAction`)                                                                                                                                                                                                                                                                                                                                                                     | D     |
| `forms/[formId]` (builder)                                       | the working draft, its two advisory lists, settings, status per environment                                                                        | search the question library, validate a draft                                                                 | apply a draft, with new questions (today's accept, `handler.ts:349`); update settings (`updateSettingsAction`, `forms/actions.ts:285`); publish (`publishFormAction`, `forms/actions.ts:376`); publish and release to any environment, `prod` included (`publishAndReleaseAction`, `forms/actions.ts:441`); close or reopen in the current environment (`setFormStatusAction`, `forms/actions.ts:517`) | A, D  |
| `forms/[formId]/rules`                                           | rules, steps, pinned questions, rule verdicts                                                                                                      | validate a draft; test a rule against hypothetical answers (`previewConditionAction`, `forms/actions.ts:330`) | apply a draft                                                                                                                                                                                                                                                                                                                                                                                          | D     |
| `forms/[formId]/preview`                                         | the draft's steps and rules                                                                                                                        | project the draft for hypothetical answers (`previewDraftAction`, `forms/actions.ts:482`)                     | none on this screen (navigation)                                                                                                                                                                                                                                                                                                                                                                       | C     |
| `forms/[formId]/versions`                                        | versions, dates, where each is released                                                                                                            | diff two versions                                                                                             | publish the draft (`publishFormAction`)                                                                                                                                                                                                                                                                                                                                                                | D     |
| `forms/[formId]/versions/[version]`                              | that version's definition                                                                                                                          | diff against the draft or another version                                                                     | release this version (`releaseVersionAction`)                                                                                                                                                                                                                                                                                                                                                          | D     |
| `forms/[formId]/releases`                                        | release history per environment, with who released                                                                                                 | none                                                                                                          | release, promote or roll back to any environment, `prod` included, under ADR-40's approval rule (`releaseVersionAction`, `forms/actions.ts:409`)                                                                                                                                                                                                                                                       | D     |
| `forms/[formId]/links`                                           | links by state and expiry in the current environment (no tokens exist to send, `forms/actions.ts:546-549`)                                         | count links by state                                                                                          | mint links, URLs to the user only (`mintLinksAction`, `forms/actions.ts:551`); revoke a link (`revokeLinkAction`, `forms/actions.ts:601`)                                                                                                                                                                                                                                                              | D     |
| `forms/[formId]/webhooks`                                        | endpoints with full URL and state; delivery status, attempts, HTTP status codes and times; never payloads                                          | delivery status                                                                                               | create an endpoint, secret to the user only (`webhooks/actions.ts:44`); rotate a secret, likewise (`webhooks/actions.ts:61`); deactivate or reactivate (`webhooks/actions.ts:78`, `webhooks/actions.ts:95`); retarget, old and new URL on the card (`webhooks/actions.ts:112`); redeliver one or all (`webhooks/actions.ts:136`, `webhooks/actions.ts:150`)                                            | D     |
| `forms/[formId]/responses`                                       | applied filters, counts, and the listed responses' metadata: session id, started and submitted times, version, access type, flag status and reason | list and count responses under filters, metadata only (writes a SEC-15 `read` row)                            | apply filters (navigation); export with format, shape, version and filters (the export route, `apps/admin/app/(shell)/forms/[formId]/export/route.ts`)                                                                                                                                                                                                                                                 | D     |
| `forms/[formId]/responses/[sessionId]`                           | that response's metadata: session id, started and submitted times, version, access type, flag status and reason; **never its answers**             | none                                                                                                          | erase, with the reason and the typed confirmation the dialog asks for (`eraseSessionAction`, `responses/actions.ts:55`); unflag (`unflagResponseAction`, `responses/actions.ts:73`)                                                                                                                                                                                                                    | D     |
| `questions` (library)                                            | questions with ids, slugs, latest version and status                                                                                               | search the library                                                                                            | create a question (`createQuestionAction`, `questions/actions.ts:101`)                                                                                                                                                                                                                                                                                                                                 | D     |
| `questions/new`                                                  | none                                                                                                                                               | search the library                                                                                            | create a question (`createQuestionAction`)                                                                                                                                                                                                                                                                                                                                                             | D     |
| `questions/[questionId]`                                         | the question's versions and definitions                                                                                                            | search the library; diff versions                                                                             | save a draft version (`saveDraftAction`, `questions/actions.ts:127`); publish, deprecate or open a new version (`lifecycleAction`, `questions/actions.ts:160`)                                                                                                                                                                                                                                         | D     |
| `responses` (form picker)                                        | forms the user may read responses for                                                                                                              | none                                                                                                          | none (navigation)                                                                                                                                                                                                                                                                                                                                                                                      | C     |
| `responses/erasures`                                             | the erasure log: session ids, reasons, times (it holds no answers)                                                                                 | none                                                                                                          | none on this screen (erasure is proposed from a response)                                                                                                                                                                                                                                                                                                                                              | C     |
| `webhooks` (dead letters)                                        | dead deliveries by form, HTTP status and attempt count; never payloads                                                                             | dead-letter counts                                                                                            | redeliver one or all (`redeliverAction`, `redeliverAllAction`)                                                                                                                                                                                                                                                                                                                                         | D     |
| `workspaces`                                                     | the workspaces the user administers; the user's own grants                                                                                         | none                                                                                                          | none on this screen (navigation)                                                                                                                                                                                                                                                                                                                                                                       | C     |
| `workspaces/[workspaceId]`                                       | members with names and emails, roles, access groups and their grants, workspace settings, the access audit                                         | none                                                                                                          | create or remove an access group; grant or revoke a group; set a member's role; save workspace settings (`workspaces/[workspaceId]/actions.ts:41`, `:66`, `:82`, `:102`, `:119`, `:139`), each under ADR-41's self-grant rule                                                                                                                                                                          | D     |
| `settings`                                                       | the user's own account: name, email, two-factor state                                                                                              | none                                                                                                          | change password (hand-off); regenerate recovery codes (hand-off; codes to the user only); re-enrol two-factor (hand-off into the sign-out and sign-in flow the screen uses); sign out                                                                                                                                                                                                                  | D     |
| `sign-in`, `two-factor/*`, `change-password` (outside `(shell)`) | no launcher: no signed-in user to act for                                                                                                          | none                                                                                                          | none                                                                                                                                                                                                                                                                                                                                                                                                   | n/a   |

## 13. Phasing and proposed tasks

All four phases are **launch scope and on the launch gate** (section 1.2). The work orders are 080 (A), 081 (B), 082 (C) and 083 (D), implemented and merged as one PR (Code Owner, 2026-10-24).

**A. Polish in place (form builder).**
Compact header with icon buttons; bubbles and segments; the in-house Markdown renderer and its hostile-input tests; plain-language timeline; streaming caret; multi-line composer and Stop; focus fixes (4.4); streaming improvements 1 to 6 (section 9) with the prompt version bump.

**B. Thinking.**
`QCMS_AGENT_THINKING`, the provider mapping, the `reasoning` events, the disclosure, rows in `docs/agent-authoring.md` and `docs/operations.md` and the env reference, and the fake provider's reasoning scripts.

**C. Launcher and panel on every screen, the form subtree first.**
The shell-mounted launcher; float, dock and sheet; the admin screen table and its filesystem test; the API `SCREENS` registry with context builders; a second assist route for screens with no form (`POST /admin/assist`, the same limiter key, a route-policy row per screen cell); conversation continuity; the 2.4.11 scroll-padding publication.

**D. Actions, screen by screen.**
**D0 first:** `proposal-token.ts` with the derived key and the ordered step list, `provenance.ts` with the in-order and reference checks, the `control.agent_actions` migration with its grants and revokes, the grant filter over offered action kinds, the `action` and `plan` SSE events, the card and plan-card shell with the four rules of 4.10, the hand-off variant, the sequential runner with stop-at-first-failure and its per-step report, and the SEC-17 tests.
Then, as proposed tasks: D1 builder and rules; D2 releases and versions; D3 links; D4 responses and one response (metadata reads, export, erase, unflag); D5 per-form webhooks and dead letters; D6 question library and question detail; D7 forms list and new form; D8 workspace administration; D9 settings (hand-off steps and sign-out).
Each carries: its action-kind descriptors, its result allowlist, its card templates and catalog strings, the trailing token argument on its server actions and the audit helper call in the handlers they reach, fake-provider scripts, unit and integration tests, Playwright confirm and cancel paths alone and inside a plan, and axe over the card states.

**Task 038.** `docs/features/038-launch-gate-validation.md` carries the assisted run of section 1.2 as goal 7, with its own exit criterion, and depends on all of A to D.

## 14. Test strategy

**Fake provider (`fake-model.ts`, extended).**
Scripts are selected by the existing `#qcms-fake:<script>` directive (`apps/api/src/features/forms/assist/README.md:96-102`).
New scripts: `narrate-then-tools`; `reasoning` (proves `summary` forwards and `off` drops); `propose-<kind>` for every action kind; `plan-three` (publish, release the published version, mint links) for the sequential runner and references; `plan-fails-at-2` (step 2 refused by the API, step 3 never sent); `two-proposals` (the second is refused; P1); `plan-26-steps` (refused; P2); `unknown-tool` (turn ends with no proposal); `injection-follow`, which obeys an instruction planted in a fixture question title and slips a production release and a webhook retarget into a plausible plan, to prove that nothing runs without Confirm, that the plan displays every step with its true arguments and the production band, and that the user's own grants still refuse what they cannot do; `read-only-user`, run as a `forms.viewer`, asserting no action kind is offered; `read-all`, for the sentinel test.

**API, Vitest.**
Registry and screen key-set tests; the grant filter per role (a `forms.viewer` is offered no kind; a `forms.editor` is offered no production release kind); token tests for tamper, expiry, wrong user, wrong route, argument mismatch, environment mismatch, **out-of-order step, skipped step, reordered list, a reference resolved to a value other than the recorded one**, flag off, and per-step replay against Postgres; a request with no token and a request with a token both authorised exactly by route policy, so the token adds provenance and never rights; the sentinel payload test per screen, asserting answers absent and session ids present; the schema vocabulary test; `handlePart` mapping tests for `tool-input-start`, segments and reasoning under both settings; the audit row asserted per proposable handler and per plan step; the SEC-15 `read` row for an agent response read; `apps/api/e2e/security/03-db-least-privilege.e2e.ts` gains the new table's exact grant set.

**Admin, Vitest.**
The screen table test; card and plan rendering from arguments (a model reason cannot change a title, hide an argument or hide a step); hand-off steps never carrying a token and only ever last; the sequential runner's stop-at-first-failure and its report; the result allowlists; the Markdown renderer's hostile inputs; the stream parser's new events; `messageForError` covering every new code.

**Playwright (`apps/admin/e2e/`), against the fake provider.**
The launcher on every `(shell)` page, Settings included, and on none outside it; `Alt+Shift+A`; Escape and focus return in float, dock and sheet; dock persisted with no layout jump; the narrow sheet; reduced motion emulated; streaming visible before the first tool completes; a confirm and a cancel path per action kind, alone and inside a plan, asserting the screen's own state changed and the audit rows exist; a three-step plan run end to end and one stopping at its second step, asserting the report and that step 3's state is unchanged; the erasure step requiring its typed confirmation; a hand-off step opening the screen's own field; a read-only user seeing no write proposal; the 2.4.11 assertion with the panel floating; axe on the launcher, the open panel, a streaming turn, the thinking disclosure and each card and plan state.

**Manual.** One NVDA and one VoiceOver pass over a full turn with a plan. A live-provider smoke stays env-gated and manual (`docs/features/041-agent-form-building.md:33`). Task 038's assisted run (section 1.2).

## 15. Records this design touches

- **`docs/agent-principle.md`** holds the principle (Code Owner, 2026-10-19; it arrives through its own pull request, #1071). Everything below cites it and none restates it.
- **ADR-25**, amended in `docs/adr/admin.md`: the decision is governed by `docs/agent-principle.md`, which supersedes the Decision's "cannot publish, erase, manage links or webhooks, or read response data"; the scope ruling and the decided defaults are recorded beside it. Title "Agent proposes, human confirms"; number unchanged.
- **SEC-17, "Agent action surface"**, a new control in `docs/SECURITY_DESIGN.md` section 8d, derived for the principle, with the proposal token's row in the SEC-7 inventory (§4). The SEC range reads `SEC-1…17` in `CONTRIBUTING.md`, `README.md`, `docs/ARCHITECTURE.md`, `apps/api/CONTRIBUTING.md` and the header of `docs/SECURITY_DESIGN.md`.
- **Scope:** `docs/PROJECT_GOAL.md` sections 5 and 8, `docs/IMPLEMENTATION_PLAN.md` stage 8a and the launch-gate exit, and `docs/features/README.md`'s selection constraints.
- **Wording (Q17):** `PROJECT_INSTRUCTIONS.md` and `docs/agent-seam.md` cite `docs/agent-principle.md`.
- **Task 038:** `docs/features/038-launch-gate-validation.md` depends on phases A to D of this plan, cites the ruling, and carries the assisted run as goal 7 with its exit criterion. The phases are work orders 080 to 083.
- **Not edited here, and changed when the work lands:** `docs/agent-authoring.md` section 4 describes the shipped four-tool surface and stays true until phase D; ADR-24, ADR-27, ADR-40 and ADR-41 need no change, because every step runs through their existing routes and policy.

## 16. Remaining open questions

The principle and the rulings settle everything else. Two caps were added by the executor while writing the plan design; both were **ruled as recommended** (Code Owner, 2026-10-24):

- **P1. One proposal per turn.** A turn ends with at most one card or one plan, and a second propose call in the same turn is refused with "put the steps in one plan". Recommended, because it makes "one plan, one Confirm" the only way a multi-action request reaches the user and removes a second card as a place to hide an act.
- **P2. At most 25 steps per plan.** A payload bound, like the conversation cap (`schema.ts:27`), not a permission rule. Recommended, because a plan longer than that is unreadable on one card, and the reader of the card is the control.
