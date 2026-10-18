# The agent on every admin screen

**Status:** design for Code Owner ruling, written against `origin/main` at `1cd3bdf7`.
Nothing here is built.
The five rulings of 2026-10-19 (section 1) are the Code Owner's and are not reopened here; they are recorded normatively as the ADR-25 amendment in `docs/adr/admin.md`.
Everything else in this document is a recommendation: the architecture that implements those rulings, a draft new control SEC-17 in `docs/SECURITY_DESIGN.md`, a phasing, and the questions in section 16 that still need a ruling.

Every claim about current code cites `path:line` at `1cd3bdf7`.
Vendor behaviour is cited from the installed package types (`ai` 7.0.136, `@ai-sdk/anthropic` 4.0.78, `@ai-sdk/openai` 4.0.91, `@ai-sdk/google` 4.0.93, `@ai-sdk/provider` 4.0.26) and from the AI SDK's Anthropic provider page (ai-sdk.dev, "Anthropic", sections "Reasoning", "Thinking Display" and "Thinking Updates", read 2026-10-19).

---

## 1. The rulings this design implements

Code Owner, 2026-10-19:

1. **The UX is drab and must change.** Today there is one large collapse button and a panel that exists only in the form builder. Wanted: a Confluence/Rovo-style floating launcher, a floating or dockable panel on every admin screen, visibly streamed responses, and visible thinking.
2. **The form builder was the first use case, not the scope.** The agent can act on every admin screen, with exceptions.
3. **Propose, human confirms.** Every agent action is a card ("Release v3 to test") with Confirm and Cancel. It runs only on Confirm, with the signed-in user's own permissions, through the same server action and audit trail as the screen's own control. The agent can never exceed the user.
4. **No respondent data.** On response screens the agent works with structure and counts only (filters, counts, export settings), never answer values. No respondent data reaches the model provider.
5. **Never proposable, even with confirmation:**
   - account and sign-in security (password, 2FA, recovery codes, sessions);
   - erasing respondent data;
   - members, roles and workspace ownership;
   - webhook secrets and targets (rotate, retarget, and creating an endpoint, which sets a URL);
   - release or rollback to `prod`.

These supersede ADR-25's sentence "The assistant cannot publish, erase, manage links or webhooks, or read response data" (`docs/adr/admin.md:19`).

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

**The safety properties worth keeping are structural, and this design keeps all of them.**
One frozen registry and one dispatch door that refuses any name outside the allowlist (`apps/api/src/features/forms/assist/tools.ts:41-55`, `tools.ts:190-215`, `tools.ts:257-265`).
A context object whose shape is the PII boundary (`apps/api/src/features/forms/assist/types.ts:89-100`), pinned by a key-set test.
A loop that ends at the step that reached for a refused verb (`assistant.ts:301-305`).
A server-run validation over every proposal (`assistant.ts:495-509`).
A per-principal rate limit on turns (`apps/api/src/features/forms/assist/route.ts:100-113`, `route.ts:121`).
A flag that gates the mount rather than a handler branch (`route.ts:115-116`; `apps/admin/app/(shell)/forms/[formId]/assist/route.ts:51`).
And the one property that makes the confirm model cheap to reason about: **the turn never executes a mutation**. Today's "Accept" is already a separate human request (`handler.ts:349-451`).

## 3. Goals and non-goals

**Goals.**

- A launcher and panel on every authenticated admin screen, floating by default and dockable, with a full-screen sheet on narrow viewports.
- Responses that visibly stream from the first second of a turn: narration before tools, a live step timeline in plain language, a streaming caret, and an optional thinking disclosure.
- The agent can propose any action a screen's own controls offer, except the five never-proposable classes; every proposal is a card; nothing runs without Confirm; Confirm runs the screen's own server action as the signed-in user.
- No respondent data in any provider payload, enforced by the shape of what each screen hands the agent, not by a prompt.
- The never-proposable classes enforced server-side, at proposal time and again at execution time, not merely absent from the UI.
- Every confirmed agent action is distinguishable in the audit trail as agent-proposed and human-confirmed.

**Non-goals.**

- **No autonomous execution.** No "confirm all", no auto-confirm, no scheduled or background agent runs. One Confirm press runs one action.
- **No agent in the serving path.** The portal, `evaluateRules`, the stored snapshot and the respondent API are untouched (Project Goal section 8, ADR-25).
- **No cross-session memory.** The conversation lives as long as the browser tab's shell does (section 6.3); nothing is stored server-side between turns, as today (`docs/agent-authoring.md:229`).
- **No new provider, no new framework.** The AI SDK stays below the `DraftAssistant` seam (`types.ts:171-177`); the stack is unchanged.
- **No agent on the sign-in, two-factor or change-password screens.** They sit outside `(shell)` and the launcher never mounts there.
- **Not a chatbot product.** The conversation cap (`apps/api/src/features/forms/assist/schema.ts:27`) and the step ceiling stay.

## 4. UX

### 4.1 The launcher

A circular 48 CSS px button, fixed to the inline-end, block-end corner of the viewport, 24 px from both edges, carrying the assistant icon and an accessible name from the catalog ("Open the assistant").
It is rendered once, by a client component mounted in the authenticated shell layout beside the `Announcer` (`apps/admin/app/(shell)/layout.tsx:108-112`), only when `agentAuthoringEnabled()` is true on the server.
With the flag off the component is not rendered at all, the same "absent rather than hidden" stance the builder prop takes today (`form-builder.tsx:167-173`).

The launcher hides while the panel is docked (the dock has its own close button) and while the narrow-viewport sheet is open.
It shows a small status dot, never colour alone: a text badge "Working" while a turn runs with the panel closed, and "1 action to review" when a proposal card is waiting.

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

- **A global shortcut opens or focuses the panel.** Recommended `Alt+Shift+A` on every platform; it must be a modifier chord (WCAG 2.2 SC 2.1.4 then does not bind it), must not collide with the CodeMirror JSON pane's bindings (`Ctrl+/` toggles a comment there, which rules out the obvious choice), and must not be captured while a text input outside the panel has focus. The final chord is open question Q2. The shortcut is printed in the launcher's tooltip and in the panel's help.
- **Escape** closes the float panel and the sheet and returns focus to the element that had it before the panel opened (the launcher, or whatever was focused when the shortcut was pressed). In the dock, Escape moves focus back to the page without closing the dock. If a card's confirmation is mid-flight, Escape first cancels that card, never the turn.
- **Stop** is a button in the composer while a turn runs; it aborts the request, which aborts the upstream call as today (`handler.ts:226-230`, `handler.ts:194-196`).
- **Enter** sends; **Shift+Enter** is a newline. The composer is a multi-line text area, not the single-line `TextField` used today (`assist-panel.tsx:355-365`).

### 4.4 Focus management

- Opening moves focus to the composer. Closing returns it as above.
- A turn ending does not move focus. A **proposal card arriving** moves focus to the card's heading only when focus was already inside the panel; today's panel moves it unconditionally (`assist-panel.tsx:104-106`), which would yank a docked user out of the page.
- After Confirm or Cancel, focus moves to the card's result line (Confirmed, Cancelled, Failed), which stays in the conversation as a record.
- Navigation between screens keeps the panel open and keeps focus where the route change leaves it; the panel never steals focus on a route change.

### 4.5 WCAG 2.2 AA

- **2.4.11 Focus Not Obscured (Minimum).** The launcher and the float panel are fixed-position author content and can sit over a focused control. The shell already solves this class for the sticky top bar by measuring it and publishing a scroll padding (`layout.tsx:113-120`, `apps/admin/app/globals.css:342`), and a sticky footer once did the same at the block end (`globals.css:2343-2348`). The launcher and the float panel publish their own rectangles the same way, as `scroll-padding-block-end` and `scroll-padding-inline-end` on the document, so the browser scrolls a newly focused control clear of them. The dock needs nothing, because it is a grid track. The Playwright suite asserts the criterion directly, the way `repeat-table.pw.ts` does for tables (`docs/features/077-table-presentation.md:23`): with the panel floating, tab through each screen's controls and assert none is wholly covered by the panel or the launcher.
- **2.5.8 Target Size (Minimum).** Every icon button in the header and on cards is at least 24 x 24 CSS px with its hit area; the launcher is 48.
- **1.4.10 Reflow.** At 320 CSS px the panel is the sheet; no horizontal scrolling inside it except inside a code block.
- **1.4.13 Content on Hover or Focus.** The launcher tooltip is dismissible with Escape, hoverable, and persistent.
- **4.1.3 Status Messages.** Streaming prose is **not** announced token by token. The panel's own polite live region announces phase changes in plain language ("Searching the question library", "Drafting changes", "1 action to review") and one completion line per turn. The in-progress bubble carries `aria-busy="true"` until its text segment ends. Announcements that must survive a route change go through the shell's `Announcer` (`layout.tsx:108-112`).
- **1.4.1 Use of Color.** Card kinds, step states and the "agent proposed" marker carry text and an icon, never colour alone, the rule the current diff lines already follow (`assist-panel.tsx:573-579`).
- **Contrast** follows the admin theme tokens, including the high-contrast dark theme (`plan/high-contrast-dark-plan.md`).

### 4.6 Reduced motion

Under `prefers-reduced-motion: reduce`: no slide, scale or fade on open and close; the streaming caret is a static bar rather than a blink; the thinking indicator has no shimmer; the timeline's running state is an icon, not a spinner. Nothing about streaming itself changes, because text arriving is content, not animation.

### 4.7 Internationalisation

Every string is a catalog key in `apps/admin/lib/i18n/en.ts` under a new `agent.*` namespace (ADR-27), including every tool's plain-language label, every card title template, every refusal and every error.
**Card titles are rendered by the admin from the card's structured arguments and a catalog template, never from model text** (section 7.5), which is also what makes them translatable.
Times use `Intl` through `apps/admin/lib/i18n/format.ts` (`ADMIN_LOCALE`).
The model's own prose is whatever language the model writes; the system prompt asks it to answer in the operator's language, and nothing in the UI depends on that prose.

### 4.8 Header

One compact row, 44 px tall: the title ("Assistant"), a context chip naming what the agent can see on this screen ("Form: Vehicle quote, draft" or "This screen is not shared"), then four icon buttons with catalog names and tooltips: **New conversation**, **Dock** or **Float** (a toggle with `aria-pressed`), **Help**, **Close**.
The present text button (`assist-panel.tsx:208-212`) goes; collapse is replaced by close, since the launcher reopens.

### 4.9 Conversation

- **Bubbles.** User turns right-aligned in a filled bubble; assistant turns left-aligned, full width, unfilled, with a small avatar. Each assistant turn is a column of **segments** in arrival order: prose, a step timeline, a thinking disclosure, cards. The segments are what make a turn readable as it streams rather than as one block at the end.
- **Markdown, safely.** Model prose is rendered as Markdown through a renderer configured with **no raw HTML**, **no images**, and links rendered as links only when they are same-origin relative paths into the admin (`/forms/...`), and as plain text otherwise. Images are refused rather than proxied because a Markdown image is the classic exfiltration channel: a URL the browser fetches without a click. The admin CSP already limits `img-src` to `'self' data:` and `connect-src` to `'self'` (`apps/admin/lib/server/csp.ts:46`, `csp.ts:49`), which is defence in depth here, not the control. Code spans and fenced blocks render as monospace text with no syntax execution. The recommended renderer is `react-markdown` with its default HTML escaping, `disallowedElements: ["img"]` and a custom link component; it is a runtime dependency and needs the CONTRIBUTING threshold check and risk assessment in its own PR (Q14). The alternative is an in-house subset renderer.
- **Streaming caret.** A caret follows the last character of the segment currently streaming, and disappears when the segment ends (`text-end`, `ai` 7.0.136 `dist/index.d.ts:3177-3181`) or the turn ends.
- **Step timeline.** A compact list inside the turn, one row per tool step: an icon, a plain-language label from the catalog, and a state (running, done, failed, refused). Labels: `search_question_library` "Searching the question library", `propose_questions` "Writing new questions", `propose_draft` "Drafting changes to the form", `validate_draft` "Checking the draft", read tools "Reading {what}", propose tools "Preparing an action for you to confirm". A failed step that the model then corrected (today's `toolErrors`, `assistant.ts:220-223`) shows as failed then done, which is honest about what a small local model is doing. The row appears on `tool-input-start`, not on the parsed call (section 9).
- **Thinking disclosure.** When the operator setting allows it (section 8), a collapsed `<details>` above the turn's prose, labelled "Thinking" with a running indicator while reasoning streams and "Thought for {n} s" afterwards. Collapsed by default; its contents are rendered as plain text, never Markdown, and are visually subordinate to the answer.
- **Cards** are section 4.10.

### 4.10 Proposal and action cards

A card is the only way an agent action reaches a human, and the only place Confirm exists.

```
+------------------------------------------------------+
| (icon) Release version 3 to test           Proposed  |
|  Form: Vehicle quote                                  |
|  Environment: test   Replaces: version 2              |
|  "Version 3 adds the at-fault accident branch."       |  <- model's reason, quoted, plain text
|                                                      |
|  [ Confirm ]   [ Cancel ]   Open the Releases screen  |
+------------------------------------------------------+
```

- **Title and facts come from the admin**, from the card's kind, its structured arguments and a catalog template, using the same consequence sentences the screen's own confirmation dialog uses. The model's free text appears only as a visibly quoted "reason" line, rendered as plain text. A model therefore cannot label a card "Release to test" while its arguments say something else, and cannot hide a consequence the screen's own dialog would state.
- **Confirm** calls the screen's own server action with the card's arguments and the proposal token (section 7.4). The button shows a pending state and is disabled while the action runs; the result replaces the buttons with a result line (Confirmed, with what happened; or Failed, with the action's own error message, which is the same message the screen's control would show).
- **Cancel** marks the card cancelled locally and tells the next turn so (section 6.3). Nothing is sent to the server.
- **Open the screen** links to the screen whose control this card mirrors, for a user who wants to do it by hand or change an argument. Cards are not editable: an edited argument is a different proposal, and the token binds the arguments (section 7.4).
- **One card, one action.** No batching and no "confirm all". A turn may emit at most five cards (section 11).
- **Expiry.** A card older than its token's lifetime (ten minutes recommended) shows "Expired - ask again" and its Confirm is disabled.
- **The draft proposal is a card too.** Today's proposal panel (diff, issues, warnings, Accept, Discard; `assist-panel.tsx:254-353`) becomes the `apply-draft` card kind with the same diff and the same two advisory lists. Its Accept is unchanged and already runs through the builder's own save (`assist-panel.tsx:184-189`, `form-builder.tsx:820`).

## 5. Context model

### 5.1 How a screen exposes its context

The browser never sends context content.
It sends a **screen id** and the route's object ids, and the API builds the context itself from the database, under the caller's grants.
This keeps the PII boundary where it is today, on the API side of the wire, and means a tampered client cannot hand the model something the screen would not show.

- **Admin side.** A small typed table, `apps/admin/lib/agent/screens.ts`, maps each `(shell)` route pattern to a screen id (`form.builder`, `form.releases`, `responses.form`, and so on, the ids in section 12). The launcher reads the pathname and the route params, looks the screen up, and sends `{ screen, params }` with each turn. A route with no row maps to `none`. A test reads the route tree off the filesystem and fails when a `(shell)` page has no row, the pattern `lib/rail-routes.test.ts` uses for the rail slot (`layout.tsx:61-71`).
- **API side.** A frozen `SCREENS` registry, keyed by screen id, holds for each screen: a context builder, the names of its read tools, the action kinds it may propose, and the matrix cell (SEC-3, `docs/SECURITY_DESIGN.md:283-305`) the caller must hold to receive any context at all. The context builder returns a **typed, structure-only facts object** whose Zod schema is strict and whose fields are enumerated per screen. The selected environment comes from the same Q6 switcher header every other admin request carries.

The current `AssistContext` (`types.ts:89-100`) becomes the `form.builder` screen's context: draft, library search port, validation port, conversation, step ceiling. Its key-set test stays, and every new screen context gets one.

### 5.2 Allowed tools per screen

A turn's tool set is the intersection of the global frozen tool registry and the current screen's list.
The single door refuses any name outside **the current screen's** list, not merely outside the global one, so a read tool registered for the Releases screen cannot be called from the builder (section 7.1).

### 5.3 Conversation continuity

- **Within a form's subtree, one conversation.** Builder, Rules, Preview, Versions, Releases, Links, Webhooks and Responses for the same `formId` share one conversation. The client holds it in a React context provided by the shell layout, which persists across soft navigations within `(shell)`. Each turn carries the current screen id, and the API prepends one line to that turn, "The user is now on the Releases screen of this form", so the model knows where it is without re-reading earlier screens.
- **Leaving the form starts a new conversation**, keyed by the new subject; returning within the tab restores the old one from memory.
- **Memory only.** Nothing is written to `localStorage` or `sessionStorage`: a shared workstation would otherwise show the next user the previous user's conversation after a sign-out, because sign-out is a form post (`layout.tsx:35-40`) that does not clear tab storage. A full reload starts fresh. Persisting across reload is Q15.
- **Card outcomes join the history** as a structured `action-result` turn with a closed schema: kind, outcome, and non-secret result fields only (section 7.6). The request schema's turn shape (`schema.ts:15-18`) gains this variant.

### 5.4 Screens with no allowed actions

The panel still opens.
The context chip says what the agent can see, and the empty state says plainly what it can do here ("I can explain this screen and answer questions about it. I cannot make changes here.").
Where a screen shares nothing (`none`), the turn carries no facts and no tools, and the model can answer general questions about QCMS only.
The Settings screen is a special case: it is entirely account security, which is never proposable, and it is the one screen where a user might paste a credential into a chat box. The recommendation is to hide the launcher there (Q18).

## 6. Action and tool architecture

### 6.1 Two kinds of tool

- **Read tools** return structure, configuration and counts that the screen itself displays, never respondent content (section 10). Each declares the SEC-3 matrix cell it needs, and the door checks that cell for the calling principal with the same policy evaluator the route middleware uses (`apps/api/src/features/membership/route-policy.ts`), before running.
- **Propose tools**, one per action kind (`propose_release`, `propose_mint_links`, `propose_export`, and so on), whose input schema is the action's argument schema. A propose tool **never executes anything**. It validates the arguments, checks the denylist (section 6.3), checks that the caller's grants would permit the action (advisory; the real check is at execution), and on success appends a proposal to the turn's state and returns `{ proposed: true, proposalId }` to the model. On a failed check it returns the reason to the model as the tool result, so the model can explain or adjust; this is not a turn-ending refusal.

The turn-ending refusal stays exactly where it is: a call to a tool name that does not exist for this screen ends the turn at that step and produces no proposals at all (`assistant.ts:247-251`, `assistant.ts:301-305`, `assistant.ts:447-460`). Denied action kinds have **no propose tool**, so reaching for one is a call to a nonexistent name.

### 6.2 The registry stays module-private and frozen, with one door

```
features/agent/                      (grown out of features/forms/assist)
  tools/registry.ts     TOOLS: frozen Record<ToolName, ToolDef>; runAgentTool(name, input, ctx, state) is the only executor
  tools/read/*.ts       one module per read tool
  tools/propose/*.ts    one module per action kind; each exports its ActionKind descriptor
  screens.ts            SCREENS: frozen Record<ScreenId, ScreenDef>
  denylist.ts           NEVER_PROPOSABLE: frozen; the only module that names denied routes and predicates
  proposal-token.ts     sign and verify (SEC-7 purpose "agent-proposal")
  provenance.ts         the API middleware that verifies a token on an incoming action request
```

`runAgentTool` refuses a name outside the current screen's list before dispatch, the shape of `runAssistTool` today (`tools.ts:257-265`); the provider tool set is built from the same list, so the model is never told about tools it cannot call (`tools.ts:272-283`).
Adding a tool, a screen or an action kind is a security-reviewed change, as adding a name to `ASSIST_TOOL_NAMES` is today (`tools.ts:37-46`).

### 6.3 The denylist is server-side, in three places

`denylist.ts` names the five classes as data: the API routes (method and path) each class covers, and for routes where only some arguments are denied, a predicate over the arguments.

| Class                         | Routes and predicates (as at `1cd3bdf7`; the module names them exactly)                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account and sign-in security  | every better-auth route (password change, two-factor enable, verify, disable, recovery codes, session list and revoke); the admin's `settings/password` and `settings/recovery-codes` handlers proxy to them |
| Erasing respondent data       | the erasure route behind `eraseSessionAction` (`apps/admin/app/(shell)/responses/actions.ts:55-70`), and any future retention or purge route                                                                 |
| Members, roles, ownership     | every membership and grant write behind `apps/admin/app/(shell)/workspaces/[workspaceId]/actions.ts` (access groups, grants, revokes, member roles); ownership transfer                                      |
| Webhook secrets and targets   | create endpoint, rotate secret, retarget (`apps/admin/app/(shell)/webhooks/actions.ts:44-58`, `webhooks/actions.ts:61`, `webhooks/actions.ts:112`)                                                           |
| Release or rollback to `prod` | release (`apps/admin/app/(shell)/forms/actions.ts:409-430`) and publish-and-release (`forms/actions.ts:441-460`) where the environment is `prod`; a prod release approval (task 070)                         |

It is enforced:

1. **At registration.** A unit test walks every registered action kind's declared API route and arguments schema and fails if any route is in a denied class, or if a partially denied route's kind does not apply the predicate. A second test asserts the denylist covers every route in `route-policy.ts` whose resource is `membership`, `workspace`, or a webhook secret or target write, so a new route in a denied family is denied by default rather than by remembering.
2. **At proposal.** A propose tool runs the predicate over its arguments (a release naming `prod` returns "Releases to prod are made by you on the Releases screen" to the model and yields no card).
3. **At execution.** The provenance middleware (section 7.4) refuses any request that carries an agent-proposal token to a denied route or with denied arguments, with `403 AGENT_ACTION_DENIED`, and logs it. So even a forged or replayed token cannot make a denied act run on the agent path.

Hiding a button in the UI is not one of the three.

### 6.4 What Confirm does

Confirm calls **the screen's own exported server action**, imported by the card component, with the card's arguments and one extra trailing argument, `{ agentProposal: token }`.
That is the same function the screen's control calls, with the same `requireAdminSession()` gate (`forms/actions.ts:65-70`), the same Next origin check, the same route-bound object id (`forms/actions.ts:59-63`), the same `lib/server` call to the same API route, the same API authorisation and the same revalidation.
The only change to each server action is that it forwards the optional token as an `X-QCMS-Agent-Proposal` header on its API call, which is proxying (R2), not a decision.
Two existing actions take a `FormData` from `useActionState` (`apps/admin/app/(shell)/questions/actions.ts:101-124`, `questions/actions.ts:160-163`); the card builds the same `FormData` the screen's form would post.

### 6.5 The agent can never exceed the user

- The turn holds no executor for any mutation; proposing is not executing (section 6.1).
- Execution is an ordinary request under the user's own admin session, authorised by the API's route policy exactly as the screen's control is (`docs/SECURITY_DESIGN.md:248-250`).
- The proposal token is bound to the user who received it (section 7.4), so it cannot be carried to another user's session.
- Read tools check the caller's own matrix cells, so the agent cannot read anything the screen would not show this user.

### 6.6 Audit

The action's existing trail is written exactly as if the user had pressed the screen's own button: the release record names the user who released (ADR-40), an export writes its SEC-15 access-audit row (`docs/SECURITY_DESIGN.md:676-679`), a draft accept sets the sticky `agentAssisted` mark (`handler.ts:419`).

**In addition**, every confirmed agent action writes one row to a new append-only `control.agent_actions` table, in the action's own transaction, through one helper the proposable handlers call when `c.var.agentProposal` is set: proposal id (unique), actor, workspace, environment, form, action kind, screen, proposed-at, confirmed-at, and a detail limited to non-content fields (a version number, an environment name, a count). No `LocalizedText`, no answer value, no identifier of a respondent.
It follows the SEC-15 precedent shape: append-only, no foreign key, `INSERT` without `RETURNING` for application roles, no `UPDATE` or `DELETE` for any of them (`docs/SECURITY_DESIGN.md:699`, `SECURITY_DESIGN.md:707-715`).
The unique proposal id also makes a token single-use: a second Confirm of the same card fails on the constraint and rolls the action back.
A separate table rather than a column on each existing trail, because the trails differ per action and some actions (link minting) have none; whether it is read by workspace owners alone or also by the installation administrator, as SEC-15 is, is Q12.

## 7. Security mechanics

### 7.1 One door per screen

Section 6.2. The test that pins it: for every screen, the provider-facing tool set equals the screen's declared list, and `runAgentTool` refuses every registered name not on it.

### 7.2 Structure-only facts

Every screen's facts schema is `z.strictObject` with enumerated fields; every read tool's output schema likewise. A unit test walks every schema and fails on a field whose name matches the respondent-content vocabulary the stdout redactor already uses (`packages/observability/src/logger.ts`), so `answer`, `value`, `email` and friends cannot appear as a field without the test being edited on purpose.

### 7.3 Prompt framing

Tool results and screen facts are delimited in the messages as data, and the system prompt states that text inside them is content authored by users and never an instruction. This is a mitigation and not a control; the controls are the denylist, the confirm, and the user's own permissions.

### 7.4 The proposal token

- **What it binds.** A compact MAC token over `{ v: 1, purpose: "agent-proposal", sub: userId, pid, kind, argsDigest, environment, formId?, iat, exp }`, where `argsDigest` is a SHA-256 over the canonical JSON of the arguments the card shows and `exp` is `iat` plus ten minutes. HMAC-SHA-256 via WebCrypto (R4).
- **Key.** A distinct key per purpose is SEC-7's rule (`docs/SECURITY_DESIGN.md:190`). Whether it is a new variable (`QCMS_AGENT_PROPOSAL_KEY`, required iff the flag is on) or derived from an existing key with HKDF under a purpose label is Q13; either way it joins the SEC-7 inventory.
- **Verification**, by `provenance.ts`, mounted on the admin group only when the flag is on: signature; purpose; `sub` equals the authenticated principal; not expired; the request's route is the kind's declared route; the arguments recomputed from the request (route params and body, through the kind's descriptor) hash to `argsDigest`; the environment the request is **performed in** (the route policy's declared source, `SECURITY_DESIGN.md:250`) equals the token's; the route and arguments are not denied. Any mismatch is `403` with a stable code and **the action does not run**: a bad token is never downgraded to an ordinary human act. With the flag off, a request carrying the header is refused with `400`, so no deployment records agent provenance it cannot have produced.
- **Why the environment check matters.** Mint, revoke, close and reopen read the environment from the Q6 switcher cookie at execution time (`forms/actions.ts:517-523`, `forms/actions.ts:564-571`). A card proposed while the switcher said `test` must not run against `prod` because the user switched before pressing Confirm.

### 7.5 Card rendering

Section 4.10: titles and consequences from the catalog and structured arguments; model text quoted and plain.

### 7.6 Result redaction

What an executed action returns to the screen and what the next turn tells the model are different things.
The `action-result` turn carries an allowlisted summary per kind: "minted 20 links, expiring 2026-11-30" and never the link URLs, which are bearer credentials (`forms/actions.ts:543-550`); "export started, CSV long, version 3" and never a byte of the file; "released version 3 to test". The allowlist lives beside each kind's descriptor and is tested.

## 8. Thinking

- **Operator setting.** `QCMS_AGENT_THINKING`, values `off` (default) and `summary`, typed and fail-fast like `QCMS_AGENT_MAX_STEPS` (`docs/agent-authoring.md:27`), read by the API only. It is configuration, not a feature flag, and the admin never learns its value: the disclosure renders when reasoning events arrive and not otherwise, which keeps ADR-24's "clients receive behavior, not flag values" intact.
- **Vendor-neutral through `providerOptions`.** One function maps the setting to the provider's options and feeds the seam that exists and is unused today (`assistant.ts:147-153`, `assistant.ts:601-603`):

  | Provider            | `summary` maps to                                                                                                    | Source                                                                                                     |
  | ------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
  | `anthropic`         | `thinking: { type: "adaptive", display: "summarized" }`, or `display: "updates"` on models that support it           | `@ai-sdk/anthropic` 4.0.78 `dist/index.d.ts:252-271`; provider page "Thinking Display", "Thinking Updates" |
  | `openai`            | `reasoningSummary: "auto"`                                                                                           | `@ai-sdk/openai` 4.0.91 `dist/index.d.ts:1573`                                                             |
  | `google`            | `thinkingConfig: { includeThoughts: true }`                                                                          | `@ai-sdk/google` 4.0.93 `dist/index.d.ts:19-21`                                                            |
  | `openai-compatible` | nothing requested; whatever reasoning parts the endpoint emits are forwarded under `summary` and dropped under `off` | the SDK surfaces them as `reasoning-delta` parts                                                           |
  | `fake`              | scripted reasoning parts                                                                                             | `apps/api/src/features/forms/assist/fake-model.ts`                                                         |

  The SDK's top-level `reasoning` call option (`@ai-sdk/provider` 4.0.26 `dist/index.d.ts:1545`) sets effort, not visibility, and is left at the provider default; effort is a cost decision for a later setting if wanted.

- **Its own SSE event.** `handlePart` maps `reasoning-delta` to `{ type: "reasoning", delta }` and `reasoning-end` to `{ type: "reasoning-end" }` when the setting is `summary`, and to nothing when it is `off`, **even if a provider emits reasoning unasked**. The admin's mirrored event union (`apps/admin/lib/forms/assist-stream.ts:64-75`) gains both, and its parser already skips variants it does not know (`assist-stream.ts:144-166`), so an older admin build ignores them.
- **Never logged, stored or replayed beyond what the provider requires (SEC-8).** No reasoning text reaches a logger, a span, the audit table or the conversation history; the per-turn log line gains only the provider's reasoning token count, a number (`assistant.ts:426-438`). The client renders it and drops it with the turn: the replayed conversation carries text turns only (`schema.ts:15-18`). Within one turn, the SDK carries the provider's reasoning blocks between steps in memory, because Anthropic requires thinking blocks to be sent back unchanged on the next step of a tool loop (provider page, "Between-Tools Thinking"); that in-memory carry is the provider requirement and is the only replay.
- **Cost.** Reasoning tokens are billed output; the step ceiling bounds them per turn and the per-principal limit bounds turns (section 11).

## 9. Streaming improvements

Independent of thinking, and phase A:

1. **Announce a step when its input starts.** Map `tool-input-start` to a `status` event with the tool name and a step id, so the timeline row appears as soon as the model begins writing a call rather than after the whole `FormDefinition` has streamed (`assistant.ts:238-249`; `ai` 7.0.136 `dist/index.d.ts:3203-3209`). The refused-name path is unchanged: an unknown name in `tool-input-start` emits nothing, and the refusal is still recorded off the parsed `tool-call` (`assistant.ts:250`).
2. **Narrate before tools.** Change the prompt's working order (`system-prompt.ts:95-103`) to: one sentence saying what you are about to do; tools, with a short note between steps when the plan changes; then the explanation. Bump `SYSTEM_PROMPT_VERSION` (`system-prompt.ts:32`).
3. **Keep text segments.** Today every delta is folded into one `rationale` (`assistant.ts:236`). Carry the SDK's text segment ids (`text-start` and `text-end`) through as `{ type: "text", delta, segment }`, so the UI interleaves prose segments with timeline rows in arrival order. The proposal's `rationale` becomes the last segment rather than the concatenation, so pre-tool narration does not repeat inside the card.
4. **Heartbeat.** An SSE comment line every 15 seconds during long silent stretches, so an ingress idle timeout does not cut a turn. The admin parser already skips frames with no `data:` line (`assist-stream.ts:124-129`).
5. **No transform on the BFF hop.** The BFF forwards only `content-type` and `retry-after` and adds `cache-control: no-store` (`apps/admin/app/(shell)/forms/[formId]/assist/route.ts:93-101`). Add `no-transform` and `x-accel-buffering: no` there too, so a compressing or buffering ingress in front of the admin does not batch the stream; the API already sets the latter on its own hop (`handler.ts:240`).
6. **Usage stays off-screen.** Token counts remain logging only (`assist-panel.tsx:57-58`).

## 10. Respondent data

Ruling 4, made structural:

- **No read tool reads an answer.** None of the screen context builders or read tools take a database handle; each is a closure over one named query helper, the property `types.ts:78-88` states for today's two ports. The response screens' read tool calls the existing filtered list route's **count** and returns `{ count, filters }`, never a row.
- **Filters are structure.** The response list's filters are `version`, `from`, `to` and `flagged` (`apps/admin/lib/ops/response-filters.ts:58`); none takes an answer value, so a count is never "how many answered X".
- **No session ids to the provider.** A `ses_` id is a permitted pseudonymous correlator in telemetry (`docs/SECURITY_DESIGN.md:663`) but has no use in a prompt, so no fact or tool output carries one.
- **Export is a setting, not a read.** The export card carries format, shape, version and filters (`apps/admin/lib/ops/export.ts:33-60`); Confirm triggers the existing streaming download route in the user's browser, which writes its own SEC-15 export row. Not one byte of the file reaches the API's agent code or the provider.
- **Webhook payloads and consumer responses never enter context.** The webhook screens' facts are endpoint state (active or not), the endpoint's scheme and host with the query string masked (the Q58 masking rule, `docs/SECURITY_DESIGN.md:309`), delivery counts by status, and HTTP status codes. Never a payload, never a consumer's response body, never a last-error string that may quote one.
- **Erasure tombstones as counts.** The erasure log's facts are counts by reason and month, never a session id or a time that singles one out.
- **Proved against a real database.** `assist.integration.test.ts`'s sentinel test (README, `apps/api/src/features/forms/assist/README.md:59-62`) generalises: with a submitted answer carrying a sentinel in the database, the fake provider calls every read tool of every screen, the exact provider payload bytes are captured, and the sentinel is asserted present in the database before it is asserted absent from the payload.

Counts are respondent-derived (`docs/SECURITY_DESIGN.md:663` says so of instance counts), and the ruling admits them. Two refinements are open: whether a count over a narrow date range needs small-cell suppression before it reaches a hosted provider (Q9), and whether an agent count read writes a SEC-15 `read` row (Q10).

## 11. Security analysis

| Threat                                                                                                                                            | Mitigations                                                                                                                                                                                                                                                                                                                                                                                   | Controls              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Prompt injection via authored content** (form and question titles, option labels, a shared workspace's questions written by another department) | Never-proposable classes refused at three points (6.3); every action needs a human Confirm on a card whose title and consequences the admin renders from structured arguments (4.10); execution under the user's own grants (6.5); object ids bound from the route, and a proposal naming another form refused, as `propose_draft` does today (`tools.ts:161-168`); data framed as data (7.3) | SEC-17, SEC-3, SEC-9  |
| **Prompt injection via webhook delivery payloads or consumer responses**                                                                          | Never in context (10)                                                                                                                                                                                                                                                                                                                                                                         | SEC-17, SEC-6, SEC-8  |
| **Confused deputy**                                                                                                                               | The turn has no executor; Confirm is an ordinary request under the user's session; the token is bound to the user, the arguments and the environment; API route policy unchanged (6.5, 7.4)                                                                                                                                                                                                   | SEC-3, SEC-17         |
| **Data exfiltration to the provider**                                                                                                             | Structure-only facts and outputs with strict schemas and a vocabulary test (7.2); respondent data structurally unreachable (10); thinking never logged (8)                                                                                                                                                                                                                                    | SEC-17, SEC-8, SEC-13 |
| **Exfiltration through the panel** (a Markdown image or link the browser fetches)                                                                 | No images, no raw HTML, external links as text (4.9); CSP `img-src 'self' data:` and `connect-src 'self'` (`csp.ts:46-49`)                                                                                                                                                                                                                                                                    | SEC-9, SEC-17         |
| **Exfiltration through an action** (a webhook to an attacker's URL)                                                                               | Creating an endpoint and retargeting are denied; redelivery only to a target a human set; minted link URLs and exports go to the user, never back to the model (7.6)                                                                                                                                                                                                                          | SEC-17, SEC-6         |
| **Tampered or stale card**                                                                                                                        | Token binds the argument digest and the environment; ten-minute expiry; card not editable (7.4)                                                                                                                                                                                                                                                                                               | SEC-17, SEC-7         |
| **Replay**                                                                                                                                        | Unique proposal id in `control.agent_actions`; a second Confirm fails and rolls back (6.6)                                                                                                                                                                                                                                                                                                    | SEC-17                |
| **Social engineering by the model** ("this is safe, just confirm")                                                                                | The model's text is visually quoted and never inside the card's title or consequence lines; no "confirm all"; one card per action                                                                                                                                                                                                                                                             | SEC-17                |
| **Cost and rate**                                                                                                                                 | One per-principal limiter key across every assist route (`route.ts:106-111` keys on the principal already; new routes reuse the key), step ceiling, conversation cap (`schema.ts:27`), at most five cards per turn, thinking off by default, token counts logged                                                                                                                              | ADR-25, SEC-8         |
| **CSRF and origin on new routes**                                                                                                                 | Every new admin route handler carries `isSameOriginPost()` and its own session gate, enforced by `apps/admin/lib/server/shell-route-guards.test.ts:46`; server actions keep Next's origin check; no CORS headers; the API is reached only over SEC-4's channel                                                                                                                                | SEC-9, SEC-4          |
| **Telemetry leakage**                                                                                                                             | New log events carry counts and ids only and are added to the OTLP event vocabulary; attributes outside the allowlist drop on export, as today (`assistant.ts:462-476`)                                                                                                                                                                                                                       | SEC-13                |

## 12. Inventory of admin screens

Screen ids are the admin route patterns under `apps/admin/app/(shell)/`.
"Facts" is what the API puts in front of the model on that screen; "denied" names the ruling class.
Every proposable action is a card whose Confirm calls the named server action.

| Screen (route)                                                   | Facts sent to the model                                                                                          | Read tools                                                                                                                                                           | Proposable actions (server action)                                                                                                                                                                                                                                                                                                                                                  | Denied (class)                                                                  | Phase |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----- |
| `forms` (list)                                                   | form ids, slugs, titles, status per environment in the switcher's environment, latest version numbers            | search forms                                                                                                                                                         | create a form (`createFormAction`, `forms/actions.ts:130`)                                                                                                                                                                                                                                                                                                                          | none on this screen                                                             | D8    |
| `forms/new`                                                      | none beyond the workspace the user may create in                                                                 | none                                                                                                                                                                 | create a form with a proposed slug and title (`createFormAction`)                                                                                                                                                                                                                                                                                                                   | none                                                                            | D8    |
| `forms/[formId]` (builder)                                       | the working draft, its two advisory lists, settings, status in the current environment                           | search the question library, validate a draft (today's two)                                                                                                          | apply a draft, with new questions (today's accept, `handler.ts:349`); update settings (`updateSettingsAction`, `forms/actions.ts:285`); publish a version (`publishFormAction`, `forms/actions.ts:376`); publish and release to a non-prod environment (`publishAndReleaseAction`, `forms/actions.ts:441`); close or reopen (`setFormStatusAction`, `forms/actions.ts:517`, see Q3) | publish and release to `prod` (release to prod)                                 | A, D1 |
| `forms/[formId]/rules`                                           | the draft's rules, steps and pinned questions, the rule verdicts                                                 | validate a draft; test a rule against **hypothetical** answers the user or model writes (`previewConditionAction`, `forms/actions.ts:330`), never respondent answers | apply a draft (rules changes)                                                                                                                                                                                                                                                                                                                                                       | none                                                                            | D1    |
| `forms/[formId]/preview`                                         | the draft's steps and rules                                                                                      | project the draft for hypothetical answers (`previewDraftAction`, `forms/actions.ts:482`)                                                                            | none                                                                                                                                                                                                                                                                                                                                                                                | none                                                                            | C     |
| `forms/[formId]/versions`                                        | published version numbers, dates, whether each is released where                                                 | diff two versions                                                                                                                                                    | publish the draft (`publishFormAction`)                                                                                                                                                                                                                                                                                                                                             | none                                                                            | D3    |
| `forms/[formId]/versions/[version]`                              | that version's definition                                                                                        | diff against the draft or another version                                                                                                                            | none (release is on the Releases screen)                                                                                                                                                                                                                                                                                                                                            | none                                                                            | D3    |
| `forms/[formId]/releases`                                        | release history per environment (version, from, when, by role not name), the live environment set                | none                                                                                                                                                                 | release, promote or roll back to a non-prod environment (`releaseVersionAction`, `forms/actions.ts:409`)                                                                                                                                                                                                                                                                            | any release, promotion, rollback or approval naming `prod` (release to prod)    | D2    |
| `forms/[formId]/links`                                           | link counts by state and expiry in the current environment; no tokens exist to send (`forms/actions.ts:546-549`) | count links by state                                                                                                                                                 | mint links (`mintLinksAction`, `forms/actions.ts:551`); revoke a link (`revokeLinkAction`, `forms/actions.ts:601`); see Q4 for `prod`                                                                                                                                                                                                                                               | none                                                                            | D4    |
| `forms/[formId]/webhooks`                                        | endpoint active state, scheme and host with query masked, delivery counts by status, HTTP status codes           | delivery counts                                                                                                                                                      | deactivate or reactivate an endpoint (`webhooks/actions.ts:78`, `webhooks/actions.ts:95`); redeliver one or all dead deliveries (`webhooks/actions.ts:136`, `webhooks/actions.ts:150`); see Q5                                                                                                                                                                                      | create an endpoint, rotate a secret, retarget (webhook secrets and targets)     | D6    |
| `forms/[formId]/responses`                                       | applied filters, total and filtered counts, versions that have responses                                         | count responses under filters                                                                                                                                        | apply filters (a navigation card, no mutation); export with format, shape, version and filters (the export route, `apps/admin/app/(shell)/forms/[formId]/export/route.ts`)                                                                                                                                                                                                          | erase a response (erasing respondent data); any answer read (ruling 4)          | D5    |
| `forms/[formId]/responses/[sessionId]`                           | none: the screen is one respondent's answers                                                                     | none                                                                                                                                                                 | none in this design; unflag is Q6                                                                                                                                                                                                                                                                                                                                                   | erase (erasing respondent data); any answer read                                | C     |
| `questions` (library)                                            | question ids, slugs, latest version and status                                                                   | search the library                                                                                                                                                   | create a question draft (`createQuestionAction`, `questions/actions.ts:101`)                                                                                                                                                                                                                                                                                                        | none                                                                            | D7    |
| `questions/new`                                                  | none                                                                                                             | search the library                                                                                                                                                   | create a question (`createQuestionAction`)                                                                                                                                                                                                                                                                                                                                          | none                                                                            | D7    |
| `questions/[questionId]`                                         | the question's versions and definitions                                                                          | search the library; diff versions                                                                                                                                    | save a draft version (`saveDraftAction`, `questions/actions.ts:127`); publish, deprecate or open a new version (`lifecycleAction`, `questions/actions.ts:160`)                                                                                                                                                                                                                      | none                                                                            | D7    |
| `responses` (form picker)                                        | form ids and titles the user may read responses for                                                              | none                                                                                                                                                                 | none (navigation only)                                                                                                                                                                                                                                                                                                                                                              | none                                                                            | C     |
| `responses/erasures`                                             | erasure counts by reason and month                                                                               | none                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                | erase (erasing respondent data)                                                 | C     |
| `webhooks` (dead letters)                                        | dead-delivery counts by form and HTTP status                                                                     | dead-letter counts                                                                                                                                                   | redeliver one or all (`redeliverAction`, `redeliverAllAction`)                                                                                                                                                                                                                                                                                                                      | create, rotate, retarget (webhook secrets and targets)                          | D9    |
| `workspaces`                                                     | the names of workspaces the user administers; the user's own grants                                              | none                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                | all membership and grant writes (members, roles, ownership)                     | C     |
| `workspaces/[workspaceId]`                                       | member and access-group **counts** only, no names or emails (Q11)                                                | none                                                                                                                                                                 | none; workspace settings are Q8                                                                                                                                                                                                                                                                                                                                                     | members, roles, access groups and grants, ownership (members, roles, ownership) | C     |
| `settings`                                                       | none                                                                                                             | none                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                | everything (account and sign-in security); launcher hidden, Q18                 | C     |
| `sign-in`, `two-factor/*`, `change-password` (outside `(shell)`) | no launcher                                                                                                      | none                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                | everything (account and sign-in security)                                       | n/a   |

## 13. Phasing

Each phase is its own PR or series of PRs, each with its own tests and gates; task numbers are allocated when the Code Owner rules.

**A. Polish in place (form builder only, no new capability).**
Compact header with icon buttons; bubbles and segments; the safe Markdown renderer (with its dependency PR if Q14 picks one); plain-language timeline; streaming caret; the multi-line composer and Stop; focus fixes from 4.4; streaming improvements 1 to 6 of section 9 with the prompt version bump.
Needs no ADR change: it changes how today's surface looks and streams, not what it can do.

**B. Thinking.**
`QCMS_AGENT_THINKING`, the provider mapping, the `reasoning` events, the disclosure, `docs/agent-authoring.md` and `docs/operations.md` rows, the env reference, and the fake provider's reasoning scripts.

**C. Launcher and panel on every screen, the form subtree first.**
The shell-mounted launcher; float, dock and sheet; the admin screen table and its filesystem test; the API `SCREENS` registry with context builders for the form subtree, then read-only facts for the rest; a second assist route for screens with no form (`POST /admin/assist`, the same limiter key, a route-policy row per screen cell); conversation continuity; the 2.4.11 scroll-padding publication.
At the end of C the agent can see and explain every screen it is allowed to and can still propose only today's draft changes.

**D. Per-screen action tools, one screen at a time.**
**D0 first, before any new action:** `denylist.ts` and its two registration tests, `proposal-token.ts`, `provenance.ts`, the `control.agent_actions` migration with its grants and revokes, the SEC-17 tests, and the `action` SSE event and card shell.
Then D1 builder, D2 releases, D3 versions, D4 links, D5 responses, D6 per-form webhooks, D7 question library, D8 forms list and new form, D9 dead letters.
Each screen PR carries: its propose tool modules and descriptors, its result allowlist, its card component and catalog strings, the trailing token argument on the server actions it confirms through and the audit helper call in the handlers they reach, a fake-provider script that proposes each kind and one that tries each denied neighbour, unit tests, an integration test, Playwright confirm and cancel paths, and axe over the card states.

## 14. Test strategy

**Fake provider (`fake-model.ts`, extended).**
Scripts are selected by the existing `#qcms-fake:<script>` directive (`apps/api/src/features/forms/assist/README.md:96-102`).
New scripts: `narrate-then-tools` (prose before and between tools); `reasoning` (reasoning parts, to prove `summary` forwards and `off` drops them); `propose-<kind>` for every action kind; `rogue-<class>` for each never-proposable class, both as a nonexistent tool name (turn ends refused, no cards) and as a valid propose tool with denied arguments (no card, turn continues); `injection-follow`, which reads an injected instruction planted in a fixture question title and obeys it, to prove that the denylist, the card and the user's own permissions hold when the model is fully compromised; `read-all`, which calls every read tool on the screen for the sentinel test.

**API, Vitest.**
Registry and screen key-set tests; the denylist registration and coverage tests (6.3); token tests for tamper, expiry, wrong user, wrong route, argument mismatch, environment mismatch, denied route, flag off, and replay against Postgres; the sentinel payload test per screen (10); schema vocabulary test (7.2); `handlePart` mapping tests for `tool-input-start`, segments, reasoning under both settings; the audit row asserted per proposable handler, as the environment role and from source for the control pool, the way SEC-15 is asserted (`docs/SECURITY_DESIGN.md:707`); `apps/api/e2e/security/03-db-least-privilege.e2e.ts` gains the new table's exact grant set.

**Admin, Vitest.**
The screen table test against the route tree; card rendering from arguments (a model reason cannot change the title); the result allowlist; the stream parser for the new events; `messageForError` covers every new code, as `assist-error-codes.test.ts` does today.

**Playwright (`apps/admin/e2e/`), against the fake provider.**
The launcher on every `(shell)` page and on none outside it; the shortcut; Escape and focus return in float, dock and sheet; dock persisted across reload with no layout jump; narrow viewport sheet; `prefers-reduced-motion` emulated; streaming visible before the first tool completes (a timeline row exists while the turn is still running); a confirm path and a cancel path per action kind, asserting the screen's own state changed and the audit row exists; a denied attempt per class leaving no card; the 2.4.11 assertion with the panel floating; axe on the closed launcher, the open panel, a streaming turn, the thinking disclosure, and each card state.

**Manual.** One NVDA and one VoiceOver pass over a full turn with a card, recorded the way the launch accessibility pass is. A live-provider smoke stays env-gated and manual, never in CI (`docs/features/041-agent-form-building.md:33`).

## 15. Records this design touches

- **ADR-25**, amended in `docs/adr/admin.md` to record the five rulings (Code Owner, 2026-10-19). Drafted in this PR.
- **SEC-17, "Agent action surface"**, a new control in `docs/SECURITY_DESIGN.md` section 8d: the confirm model, the denylist at three points, the proposal token, the agent audit, result redaction, and the structure-only boundary. Drafted in this PR **as proposed, for ruling**. The SEC-7 inventory gains the proposal key row when Q13 is ruled.
- **`PROJECT_INSTRUCTIONS.md`** line 43, **`docs/PROJECT_GOAL.md`** sections 5 and 8, and **`docs/agent-seam.md`** line 57 said agents "assist authoring only"; that sentence is no longer true under ruling 2. Minimal wording edits are drafted in this PR so that `main` does not carry a rule the ADR now contradicts; Q17 asks the Code Owner to confirm them.
- **The SEC range** (`SEC-1…16`) is restated as `SEC-1…17` where it is written out: `CONTRIBUTING.md`, `README.md`, `docs/ARCHITECTURE.md`, `apps/api/CONTRIBUTING.md` and the header of `docs/SECURITY_DESIGN.md`.
- **Not edited here, and changed when the work lands:** `docs/agent-authoring.md` section 4 ("Can" and "Cannot") describes the shipped surface and stays true until phase D; `docs/features/041-agent-form-building.md` is the record of the first use case; ADR-24 needs no change (8); ADR-27 needs no change (4.7); ADR-40 and ADR-41 need no change, because every action runs through their existing routes and policy.

## 16. Open questions for the Code Owner

- **Q1. Launch scope.** Is this launch scope off the launch gate, as ADR-25's first use case is, or post-launch? Recommended: phases A and B launch scope off the gate; C and D post-launch, demand-ordered.
- **Q2. Shortcut.** Recommended `Alt+Shift+A`. `Ctrl+/` collides with the CodeMirror JSON pane.
- **Q3. Close or reopen a form in `prod`.** Not in the five classes. It changes production intake. Proposable, or denied with prod releases? Recommended: denied, for the same reason a prod release is.
- **Q4. Mint or revoke links in `prod`.** Not in the five classes; the URLs go to the user and never to the model. Recommended: proposable.
- **Q5. Deactivate, reactivate and redeliver webhooks.** Not secrets or targets; redelivery sends respondent payloads, but only to a target a human set. Recommended: proposable.
- **Q6. Unflag a flagged response.** It releases a withheld `response.submitted` event downstream (`responses/actions.ts:72-84`). Recommended: not proposable in this design; revisit after D5.
- **Q7. Access groups.** This design reads "members, roles and workspace ownership" as covering access groups, grants and revokes, because a grant confers a role (ADR-41). Confirm.
- **Q8. Workspace settings** (`requireSecondApprover`, `seedNewEditorsWithTestData`, `workspaces/[workspaceId]/actions.ts:139-145`). Not named in the five classes; both are authorisation-adjacent and SEC-15 audits the second. Recommended: denied.
- **Q9. Small-cell counts.** Should a count under a narrow date range be suppressed below a threshold before it reaches a hosted provider? Recommended: no suppression at first, because filters carry no answer values; revisit if a deployment asks.
- **Q10. Does an agent count read write a SEC-15 `read` row?** Recommended: yes, kind `read`, so "who looked" includes the agent's looks on a user's behalf.
- **Q11. Staff personal data.** Member names and emails are not respondent data. Recommended: never sent to the provider; counts only.
- **Q12. Agent audit table and its readers.** A new `control.agent_actions` table (recommended) or a provenance column on each existing trail; readable by workspace owners and the installation administrator, as SEC-15 is?
- **Q13. Proposal token key.** A new `QCMS_AGENT_PROPOSAL_KEY`, required iff the flag is on, or an HKDF derivation from an existing key? Recommended: derived, to add no operator burden, with its own purpose label.
- **Q14. Markdown renderer.** `react-markdown` as a new runtime dependency (with the threshold check and risk assessment in its PR), or an in-house subset renderer? Recommended: `react-markdown`, because a safe Markdown parser is security-sensitive code that a small in-house one would have to re-earn.
- **Q15. Conversation persistence across reload.** Recommended: memory only (5.3).
- **Q16. Thinking.** Default `off` recommended. On Anthropic, `display: "updates"` needs a beta header the SDK adds automatically; acceptable, or `summarized` only?
- **Q17. Project-level wording.** Confirm the drafted edits to `PROJECT_INSTRUCTIONS.md` line 43, `docs/PROJECT_GOAL.md` sections 5 and 8, `docs/agent-seam.md` line 57, and the ADR-25 title change to "Agent proposes, human confirms".
- **Q18. Settings screen.** Recommended: hide the launcher there.
- **Q19. Rate limit.** Keep 10 turns per minute per principal (`docs/agent-authoring.md:28`) once every screen has the panel, or raise the default?
- **Q20. Cards per turn.** Recommended ceiling five.
