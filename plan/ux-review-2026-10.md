# UX review: respondent portal and authoring admin, October 2026

**Status:** working analysis, 2026-10-18 · **Subject:** `apps/portal`, `apps/admin`, and the `@roonga/qcms-ui` renderer as respondents meet it · **Reviewed at:** `origin/main` `ff7625b6` · **Predecessor:** `plan/admin-ux-audit.md` (admin only, last swept 2026-08-22)

## How this was done

Two passes, recorded separately so a reader can weigh each claim:

- **Live.** The full-stack harness on port seat 7 (`QCMS_PORT_SEAT=7 pnpm docker:up`), loaded with the sample library through the seed container. Driven in Chromium: first-admin sign-in, forced password change, TOTP enrolment, every admin route on the sample form, a release to `test` and a promotion to `prod`, close and reopen, the erasure dialog, two tabs on different environments, and three respondent sessions through the branching sample form to submission. Lighthouse (accessibility, best practices, SEO) ran on the portal entry, a step and completion, and on two admin screens: every score was 100.
- **Source.** Every route, component and catalog string in both apps, read at HEAD and cited by file and line.

Each finding is tagged **Live** (seen in the browser, and the cited code explains it) or **Code** (read from the source, not reproduced). Not exercised live: the no-JavaScript path, narrow viewports, a screen reader, authoring a repeating group, and secure-link redemption. Findings in those areas are Code findings and should be confirmed before they are fixed. No screenshots were captured, because the browser pane was not visible during the run.

## 1. Summary

Both apps are in good shape on what automated checks measure. Lighthouse scored 100 everywhere, focus and error-summary work is careful, and catalog discipline is close to complete. The problems are in **meaning rather than markup**, and three themes cover most of them:

1. **The environment model has outrun the UI.** Release records (065) and environment-scoped links (066) made the environment part of the meaning of nearly every admin action. The screens have not fully caught up. In a live test, a dialog reading "Close it in prod" **closed the form in test**, because another tab had switched environments (A1). The forms list says "Open" for a form that is not released anywhere, and the portal tells respondents that the same form is "closed" (A3).
2. **"Published" still reads as "live".** Since 065 a published version is served nowhere until it is released, but the seed script, the forms list, the publish dialog and the Links screen all still speak the old language. A developer who runs `pnpm dev:seed` and opens the URL it prints lands on "This form is not accepting responses" (A3).
3. **Respondents can lose their place.** The hydrated flow adds no history entries, so the browser's Back button leaves the form, and the entry page then offers only Start, which creates a new empty session (P1, Live). On a slow connection the first click on Continue after typing is often swallowed (P4, Live).

Also confirmed live: a "None of the above" option that can be ticked together with other options, and is stored that way (P6). The respondent's date field changes from day-first to month-first when the page hydrates (P5). The same submission time is shown as Oct 17 on one admin screen and Oct 18 on the next (A9). The response detail screen shows option ids (`opt_standard`) and `true` instead of what the respondent chose (A10).

### Top ten, in recommended order

| #   | Finding                                                                                     | Sev    | Basis |
| --- | ------------------------------------------------------------------------------------------- | ------ | ----- |
| A1  | A confirmation dialog can act on a different environment than the one it names              | High   | Live  |
| A3  | Published but unreleased forms read "Open" in the admin and "closed" on the portal          | High   | Live  |
| P1  | Back or reopening the form link orphans the session; Start always begins again              | High   | Live  |
| P2  | An expired or already-submitted session reports "could not reach the server" for ever       | High   | Code  |
| P3  | Without JavaScript, Enter in a repeating-group field can activate Remove or Add             | High   | Code  |
| A2  | The draft preview does not paginate "One page per instance" as respondents see it           | High   | Code  |
| P4  | The first Continue after typing is swallowed while the blur save is in flight               | Medium | Live  |
| P5  | The date field's segment order flips from the browser's locale to US order on hydration     | Medium | Live  |
| A9  | One submission shown on two different days, in UTC on the list and local time on the detail | Medium | Live  |
| A10 | Response detail shows option ids and raw booleans instead of the respondent's choices       | Medium | Live  |

## 2. Cross-cutting themes

### 2.1 Environment awareness (admin)

The environment is a cookie (`apps/admin/lib/environment.ts:51`, `:84-93`). The banner is deliberately absent under `prod` (`apps/admin/components/environment-banner.tsx`). The switcher refreshes only its own tab (`apps/admin/components/environment-switcher.tsx:64-72`). Server actions read the cookie at the moment they run, while dialogs print the environment they were rendered with. The result is A1, plus a family of quieter gaps: per-environment screens that never name their environment (A5), uneven environment wording in destructive confirms (A6), and a release dialog that can target any environment while the banner says actions affect "this environment only" (A7). The fix is one rule applied everywhere: **an environment-sensitive action carries the environment it displayed, and the server refuses a mismatch.**

### 2.2 Publish versus release

ADR and task 065 changed the model, and the copy kept the old one. See A3 and A4. This is cheap to fix and high-value: it is the first thing a new adopter meets, and the launch gate (`docs/PROJECT_GOAL.md` §4) is a person following the README to a working form.

### 2.3 Locale and time

`PORTAL_LOCALE` and `ADMIN_LOCALE` are both `"en"` (`apps/portal/lib/i18n/format.ts:75`, `apps/admin/lib/i18n/format.ts:61`). Plain `en` resolves to US conventions in `Intl` and React Aria, whatever the browser says. The admin also mixes a fixed UTC display zone (`apps/admin/lib/i18n/format.ts:120`) with the operator's own zone (`:251-284`). Each choice is documented locally. Together they produce P5, A9 and the US-ordered date fields in the admin's response filters. ADR-27 makes this launch scope, and choosing a regional default (or honouring `Accept-Language` within the shipped catalog) is a small decision with a wide effect.

## 3. Portal findings

### P1. High · Live: Back, or reopening the form link, orphans the session

**What happened:** on step 2 the browser's Back button went to `/f/sample-library`, which offered only Start. Start created `ses_c726…` with an empty name field. The earlier session, with answers saved, could no longer be reached. The entry page meanwhile promises "Your answers are saved as you go."

**Evidence:** no history entries per step (`apps/portal/components/step-flow.tsx:779-807`, `fetch` only, no `pushState` in `apps/portal`). Start always creates a session and overwrites the one cookie (`apps/portal/app/f/[formSlug]/start/route.ts:47-52`; cookie path `/` for every form and environment, `apps/portal/lib/server/session-cookie.ts:22-25`). The promise is at `apps/portal/lib/i18n/en.ts:37`.

**Recommendation:** on the entry page, look up the existing cookie through the BFF and offer "Continue where you left off" before "Start again". Push a history entry per step view (the BFF already accepts `?step=n`) and treat `popstate` as the form's Back. Key the cookie by form and environment.

### P2. High · Code: an expired or submitted session says "We could not reach the server" for ever

The API answers `SESSION_EXPIRED` and `SESSION_SUBMITTED` with 409 (`apps/api/src/features/responses/serve-step/handler.ts:96-98`, `:718-720`). The client routes only 401 and the "semantics changed" 409 to a reload, and treats every other 409 as a network failure (`apps/portal/components/step-flow.tsx:490-506`, `:747-752`, `:795-799`). The server render already handles both codes properly (`apps/portal/app/s/[sessionId]/page.tsx:74-79`). **Fix:** route both codes to a reload, so the respondent lands on the screen that explains what happened.

### P3. High · Code: without JavaScript, Enter in a repeating-group field can remove or add an entry

The implicit-submission default button is the form's first submit button. Continue is appended last (`packages/ui/src/native-submit.ts:202-221`), after each instance's Remove and the group's Add (`packages/ui/src/repeat/RepeatInstance.tsx:85-100`, `RepeatGroup.tsx:75-88`, `RepeatRow.tsx:76-91`). No spec presses Enter inside a member field. **Fix:** put a visually hidden, non-focusable copy of Continue (same `formaction`) first in the qcms-owned `FormField` adapter (`packages/ui/src/form-field.tsx:58-73`, outside the ADR-22 freeze), and add a no-JS spec that presses Enter in a member field.

### P4. Medium · Live: the first Continue after typing is swallowed

**What happened:** three times, typing into a field and then pressing Continue did nothing. A second press advanced. Leaving the field posts the answer and sets `busy`, which disables both buttons before the click lands. A Submit pressed without a preceding edit worked first time.

**Evidence:** `apps/portal/components/step-flow.tsx:436`, `:511`, `:1098`, `:1109`.

**Caveat:** the clicks were scripted, so the gap between leaving the field and the click was tighter than a person's. The mechanism is still real on a slow network.

**Fix:** use `aria-disabled` with a guard instead of `disabled`, or queue the intent and run it when the save queue drains. Test with throttling and a real gap between mouse down and mouse up.

### P5. Medium · Live: the date field changes order on hydration

**What happened:** with an `en-GB` browser, the server-rendered native date input showed day / month / year. After hydration the React Aria field showed month / day / year (`month, Date of birth`, `day, …`, `year, …`). A respondent who starts typing before hydration, or who expects UK order, can enter 3 May for 15 March. In the first attempt the field produced `1990-05-03` from keystrokes meant as 15/03/1990.

**Evidence:** `PORTAL_LOCALE = "en"` (`apps/portal/lib/i18n/format.ts:75`) feeds React Aria's `I18nProvider` (`apps/portal/components/step-flow.tsx:1075-1078`, `apps/portal/components/native-step.tsx:329`). The native input follows the browser's locale instead.

**Fix:** pick an explicit regional default (`en-GB` or the form's locale), and make both renderings follow it. This is an ADR-27 decision for the Code Owner, because the locale is product-wide.

### P6. Medium · Live: "None of the above" is not exclusive, and contradictions are stored

**What happened:** "Diabetes" and "None of the above" were both ticked, accepted and locked as `opt_diabetes; opt_none` (visible on the admin response detail).

**Evidence:** the option comes from `packages/core/fixtures/questions/valid/multi-choice.json`. The domain model has no exclusive-option concept (no match for "exclusive" in `docs/DOMAIN_SCHEMA.md` or `packages/core/src`).

**Fix, short term:** rename the fixture option, or add a publish warning when a multi-choice option label reads like a "none" choice. **Longer term:** an `exclusive` flag on an option, enforced by the kernel. That is a domain-schema change, which needs an ADR.

### P7. Medium · Code: hydrated Continue moves past a field showing a "not valid" message

The gate checks only missing required answers (`apps/portal/components/step-flow.tsx:818-846`). The summary is built only from those (`:877-900`), whereas the no-JS path includes refused answers (`apps/portal/components/native-step.tsx:258-266`). **Fix:** block Continue while a rejection is visible, and use the shared summary entries.

### P8. Medium · Code: without JavaScript, the form submits once no required answer remains

This skips later steps that hold only optional questions (`apps/portal/app/s/[sessionId]/step/route.ts:372-387`; `flow.complete` means "nothing required is missing", `packages/core/src/evaluate-rules.ts:48-50`, `:763`). The button label is fixed at first render (`apps/portal/components/native-step.tsx:158-159`). **Within ADR-28's amendment** (`docs/adr/portal.md:23`, which stays as it is with no Back added): post the served view index, and submit only when the API confirms it was the last visible view.

### P9. Medium · Code: error notices never clear, and appear off-screen

`failed` and `countRefused` are never reset (`apps/portal/components/step-flow.tsx:334`, `:425`, `:505-509`, `:1011-1021`). They render at the top of the card, which on a phone is usually off-screen from the button that caused them. **Fix:** clear on the next success or roster change, and show failures beside the actions with a retry.

### P10. Medium · Code: step changes are announced two or three times

The progress text is a polite live region (`apps/portal/components/portal-shell.tsx:56-61`), and the announcer also speaks "Step 2 of 5: …" (`apps/portal/components/step-flow.tsx:188-198`, `:934-939`). Then the focused heading is read. Live inspection confirmed the polite region on the progress text. **Fix:** keep one spoken source per change.

### P11. Medium · Code: secure links never resume

A one-time link opened a second time says "already used", even when its session is still running. A reusable link starts a fresh session on every open (`apps/portal/app/l/[token]/route.ts:45-48`, `apps/api/src/features/responses/start-session/handler.ts:344-368`). The "could not resume" copy points back at the form link, which for a one-time link is a dead end (`apps/portal/lib/i18n/en.ts:135-137`, `:174-175`). **Decision needed:** resuming through an already-used link touches SEC-2. The copy can be fixed now.

### P12. Medium · Code: link and start failures are reported as "invalid" or "try later"

An API outage during redemption shows "This link is not valid" (`apps/portal/app/l/[token]/route.ts:29-37`, `:51`). A secure link to a challenge-protected form cannot pass the challenge, because `/l` is a GET with no widget (`apps/api/src/features/responses/start-session/handler.ts:117-118`, `:327-331`). **Fix:** add a "temporary problem, your link is fine" screen for 5xx, and an interstitial with the challenge for challenge-protected links. `LINK_WRONG_ENVIRONMENT` must stay mapped to invalid (Q16).

### P13. Medium · Code: expiry copy is wrong and the cookie lifetime is fixed

The copy says "after a period of inactivity", but expiry is fixed from the start time (`apps/portal/lib/i18n/en.ts:177-178`, `apps/api/src/features/responses/start-session/handler.ts:336-341`). The cookie is always 24 hours, whatever `QCMS_SESSION_TTL_MS` says (`apps/portal/lib/server/cookie-options.ts:17`, `:21`). **Fix:** correct the copy, and set the cookie's max age from `expiresAt`.

### P14. Medium · Code: no review before an irreversible Submit, though two documents promise one

`docs/features/076-per-instance-step.md:18` and `apps/portal/e2e/no-js-per-instance.pw.ts:24` refer to a "review step" that does not exist. **Decision needed:** build a read-only review view, or correct the documents.

### P15. Medium · Code: the Appearance panel can cover the focused field (WCAG 2.4.11)

It is an absolutely positioned overlay at z-index 40, with no Escape and no close-on-focus-out (`apps/portal/app/globals.css:234-240`, `apps/portal/components/appearance-controls.tsx:278-362`). **Fix:** after hydration, close on Escape and when focus leaves.

### P16. Medium · Code: the table presentation hides which columns are required

The asterisk lives in each cell's visually hidden label (`packages/ui/src/theme-components.css:700-719`). Column headers carry no required mark (`packages/ui/src/repeat/RepeatTable.tsx:95-109`). **Fix:** add `required` to `RepeatColumn` and mark the header, with the mark hidden from screen readers.

### P17. Medium · Code: Remove has no confirmation and no undo

`packages/ui/src/repeat/RepeatInstance.tsx:102-112`, `RepeatRow.tsx:93-104`. **Decision needed against ADR-43:** a short-lived Undo in the status area, or a confirm when the instance holds answers.

### P18. Low · Live: the page title never changes

Every portal page is titled "Questionnaire": entry, every step, closed and completion. The form's name and the step are absent, which weakens WCAG 2.4.2 and makes tabs indistinguishable. The header also reads "Questionnaire" rather than the form title. **Constraint:** R2 means the entry page has no form metadata today (`apps/portal/app/f/[formSlug]/page.tsx:33`). Inside a session, the step title is already known and can be used.

### P19. Low · Live: the respondent "closed" message is used for "not released here"

A form that was simply never released was shown as "This form is not accepting responses. The questionnaire is closed." (`/f/sample-library?state=closed`). That is truthful to a respondent, so it stays. The admin side of the same state is A3.

### P20. Low · Live: completion shows UTC and a 64-character hash

"Oct 17, 2026, 11:07 PM UTC" for a respondent whose local date was Oct 18, then a full SHA-256 as "Reference" (`apps/portal/components/completion-view.tsx:23`, `:54-59`). **Fix:** show local time, which completion can render on the client, and a short display reference with the full hash on request.

### P21. Low · Live: branching changes the step total mid-flow

Answering "Yes" turned "Step 2 of 3" into "Step 2 of 4". This is correct, but unexplained. Consider "Step 2 of about 4", or a short note when the total changes. The live announcer already says "1 question was added below", which is good.

### P22. Low · Code: other finish items

- No branded `not-found.tsx`. Live: `/test/f/sample-library` shows Next's built-in "404 This page could not be found." The 404 itself is by design (ADR-09); the unbranded page is not.
- The flow error page's Continue link resolves to `/s/` and 404s (`apps/portal/app/s/[sessionId]/error.tsx:84`).
- The no-JS error summary is not focused after reload (`apps/portal/components/native-step.tsx:289-314`).
- The hydrated path does not mark the field itself for a missing answer (open issue #967).
- "This should take a few minutes" is shown for every form, however long (`apps/portal/lib/i18n/en.ts:36`).
- The sample number question's help text, "An average across the last 12 months", is attached to "How many [at-fault accidents in 3 years]?" (`packages/core/fixtures/questions/valid/number.json:5`). It is the first form an adopter sees.

## 4. Admin findings

### A1. High · Live: a confirmation dialog can act on a different environment than the one it names

**Reproduced:**

1. In tab A (prod), open the builder and press "Close in prod". The dialog reads "Close sample-library to new sessions in prod?", with the button "Close it in prod".
2. In tab B, switch the environment to `test`, which is what the switcher does (`apps/admin/components/environment-switcher.tsx:64-72`).
3. In tab A, confirm.

Tab A then rendered "This form is closed in **test**", and prod respondents could still start. The reverse direction, acting on `prod` while the dialog says `test`, is the dangerous one.

**Evidence:**

- Actions read the cookie when they run: `apps/admin/app/(shell)/forms/actions.ts:522` (close/reopen), `:567-568` (mint), `:603-606` (revoke).
- Dialogs print a render-time prop: `form-actions.tsx:217-218`, `:454-456`; `secure-links.tsx:309`; `response-detail.tsx:546-548`.
- `environment-banner.tsx:10-14` names "open a second tab" as the case it exists for.

**Fix:** send the displayed environment with every environment-sensitive action. The server refuses a mismatch with "This tab was showing prod; you have since switched to test. Reload." Also refresh on `visibilitychange` when the cookie has changed. This keeps the decision not to put the environment in URLs (`apps/admin/lib/environment.ts:16-21`).

### A2. High · Code: the draft preview does not show "One page per instance"

Preview builds per-instance views (`draft-preview.tsx:173-181`), but passes `repeat={{ rosters, visible }}` with no `view` (`:297-300`). The portal passes it (`apps/portal/components/step-flow.tsx:1062-1066`). Each page therefore draws every instance, and the step line never names the instance (`draft-preview.tsx:266-271`). Task 076 requires the preview to walk views through the portal's renderer (`docs/features/076-per-instance-step.md:19`).

### A3. High · Live: unreleased forms read "Open" in the admin and "closed" on the portal, and the seed points at a closed form

**What happened:** after `pnpm dev:seed`-equivalent seeding, the loader printed "Published frm_sample_library v1 … Open it at /f/sample-library." The forms list said Status **Open**, Published "v1 on Oct 17". The section header said "Status: Open". The Links screen offered the public link and minting. The portal answered "This form is not accepting responses." Only the Releases screen told the truth: "Nothing released" in both environments.

**Evidence:**

- `apps/api/scripts/seed-fixtures.ts:442`
- "absent from the map reads open": `apps/api/src/features/forms/handler.ts:667-679`
- `forms-table.tsx:58`, `:96`, `:102-104`; `form-page-header.tsx:146-151`
- Minting gated on publish, not release: `apps/admin/app/(shell)/forms/[formId]/links/page.tsx:99`

**Fix:**

- Have the seed release v1 to `prod`, or print "release it on the Releases screen".
- Show intake per environment as **Not released / Open / Closed**, with a "Released in {env}" column.
- Warn or gate minting where nothing is released, reusing `forms.lifecycle.notReleasedHere` (`apps/admin/lib/i18n/en.ts:1539-1540`).

### A4. High · Code: copy still equates publishing with going live

- The publish dialog says "New sessions get v{version}" two lines before "served nowhere until it is released" (`form-actions.tsx:335-342`).
- The Links hint says "a link opens the newest published version" (`apps/admin/lib/i18n/en.ts:1735-1736`).
- The forms list treats Published as "what respondents are seeing" (`published-cell.tsx:7-8`).

**Fix:** rewrite these around releasing.

### A5. Medium · Live + Code: per-environment screens do not name their environment

Under `prod` there is no banner, so Responses ("Nothing has been submitted to this form yet"), the erasure log ("Nothing has been erased."), webhook endpoints and dead letters, and export filenames all describe one environment without saying which (`responses/page.tsx:133-148`, `responses/erasures/page.tsx:36-66`, `apps/admin/lib/ops/export.ts:113-121`, `apps/admin/lib/forms/links.ts:33-64`). **Fix:** reuse the Links screen's scope sentence (`secure-links.tsx:574-576`), and put the environment into empty-state copy and filenames.

### A6. Medium · Live: destructive confirms name the environment unevenly

Close names it in the title, body and button. Erase, the one action with no undo, ends with a bare "In prod." and the button "Erase permanently" (seen live). Revoke, rotate, deactivate, retarget and redeliver-all do not name it at all (`secure-links.tsx:371-376`, `webhook-config.tsx:403-431`). **Fix:** name the environment in every destructive title and button, for example "Erase permanently from prod".

### A7. Medium · Live: release and promotion are not guided

**What happened:** with v1 in `test`, "Release a version…" opened as "Release v1 to **prod**?" with "Promoted from: Nowhere: release it directly". The author has to know to change it to `test`. Releasing to `test` while the switcher said `prod` produced only an "In test." line. The banner meanwhile says actions affect "this environment only" (`apps/admin/lib/i18n/en.ts:117-118`). The "Promoted from" list also offered `prod` while nothing was released there, which risks a provenance record that is not true (not tested; check `apps/api/src/features/releases/handler.ts`).

**Fix:**

- Add a "Promote v{n} to {next env}" action on each "Released now" row, with the source filled in.
- Offer only environments that currently serve the chosen version as sources.
- Warn when the target differs from the switcher.
- Disable confirm when the version is already current there (`releases/handler.ts:62-67`).

### A8. Medium · Live: "Released by" shows a raw auth id, and only a date

"Released by: kPozHmkoEphJhox324gh05xf2fgN7xN3" on both tables (`release-panel.tsx:182`, `:266`; `releases/handler.ts:215`). This is not even a branded `usr_` id. "Released" shows a date with no time, though two releases on the same day are normal during promotion. **Fix:** show the email or display name with the id behind `EntityId`, and a timestamp with zone.

### A9. Medium · Live: one submission, two days

The response list showed "Oct 17, 2026, 11:07 PM UTC". The detail screen showed "Oct 18, 2026, 10:07 AM GMT+11", and its ledger used local time too. Filters say "Whole days, in UTC" and render month-first date inputs. **Evidence:** `DISPLAY_TIME_ZONE = "UTC"` (`apps/admin/lib/i18n/format.ts:120`) against the operator-zone formatter (`:251-284`). Both are documented, but together they read as a contradiction. **Fix:** pick one zone per screen family, always print the zone, and keep date filters in the same zone as the rows they filter.

### A10. Medium · Live: response detail shows ids and raw values

Locked answers and the ledger read "true", "opt_diabetes; opt_none", "opt_standard" and "1990-03-15". The list preview reads "q_accident_count: 1 · q_at_fault_accident: true", ordered by id rather than by form order. `apps/admin/lib/ops/answers.ts:10-13` says the caller resolves labels "where that resolution is available". On the detail screen it is available, because the pinned version is known. **Fix:** render "Standard", "Yes" and a localised date, with the stored value available beside it for audit. In the preview, use labels in form order.

### A11. Medium · Code: a failed release read shows "nothing released"

Version history shows no alert and "Nowhere" on every row (`versions/page.tsx:82`). The Releases screen shows an alert above tables that still say "Nothing released" and "never been released" (`releases/page.tsx:92-94`, `release-panel.tsx:169-185`, `:212-217`). This is the claim-versus-capability defect that the design contracts' §3 forbids. **Fix:** pass a `ReadState`, as `secure-links.tsx` does.

### A12. Medium · Code: the screen and the API can resolve different environments

If the environment set cannot be read, or the cookie names a dropped environment, the chrome falls back to `prod` while API calls still carry the raw cookie (`lib/server/request-environment.ts:26-44`, `layout.tsx:95-98`). The Links page uses the unchecked value directly (`links/page.tsx:56`). **Fix:** resolve once per request, and show "environment unknown" with destructive actions disabled rather than looking like `prod`.

### A13. Medium · Code: erasure failure renders behind the open dialog

`response-detail.tsx:183-191`, `:229-232`. `EraseDialog` has no error slot (`:539-583`); revoke already solves this (`secure-links.tsx:382-389`).

### A14. Medium · Code: the rail's issue count omits rule issues

`apps/admin/lib/forms/issues.ts:388-409`; `subtree-rail.ts:226-234`, `:252-257`. **Fix:** badge the Rules row, and make the total equal the validation panel's count.

### A15. Medium · Code: repeating-group authoring traps

- "One page per instance" repeats the step's other questions on every instance page, and only the first paginating group in a step paginates. Neither is surfaced (`group-panel.tsx:227-237`, `packages/core/src/evaluate-rules.ts:805`).
- The count fields snap back on clear, swallow letters, coerce a maximum of 0 to 1 silently, and do not check minimum ≤ maximum (`group-panel.tsx:350-357`, `:373-380`, `:401`, `:529-533`).

### A16. Medium · Code: unsaved edits are lost without a prompt

`apps/admin/lib/i18n/en.ts:335` warns in prose, but there is no `beforeunload` handler or navigation guard anywhere in `apps/admin`. The switcher refreshes the page too.

### A17. Medium · Code: rule removal is one click with no undo

`rules-table.tsx:174-179`, `rules-editor.tsx:144-146`, while steps and groups confirm (`step-editor.tsx:286-302`). Focus falls to the body afterwards.

### A18. Medium · Code: row actions do not name their row

"Revoke, Revoke, Revoke" and "Rotate secret" are not named for their row (`secure-links.tsx:642-652`, `webhook-config.tsx:313-358`). `dead-letters.tsx:243-249` shows the right pattern.

### A19. Low · Live: the settings screen is empty

The only content is "Signed in as …". There is no way to change the password, re-enrol or reset two-factor, regenerate recovery codes, or see sessions. Someone who loses an authenticator spends recovery codes with no way to mint more. Check against task 069's scope before building anything.

### A20. Low · Live: auth flow friction

- A failed sign-in clears the email field as well as the password.
- The forced password change states no rules (length, breach check) before submit (`apps/admin/app/change-password/page.tsx:93-108`).
- The TOTP setup key overflows its field with no copy button, while recovery codes have one (`apps/admin/app/two-factor/enroll/page.tsx:79-86`).
- Recovery codes mix case and ambiguous glyphs (`O95A7`, `lrbAh`, `nIBir`), against the project's own typography bar of unambiguous `I/l/1` and `O/0` (`docs/PROJECT_GOAL.md` §3). Both the codes and the setup key should be set in the monospace face, and grouped.
- The auth screens render dark while the shell defaults to Light, so the theme changes at the moment of sign-in.

### A21. Low · Live: the erasure confirm asks the operator to type a 36-character id

"Type ses_156869356b9238b78b6880d073fc1e7f exactly." That is safe, and paste works, but it is heavy. Consider the last 8 characters, as many consoles do. This weighs against SEC-level intent, so it is for the Code Owner.

### A22. Low · Code: catalog and naming gaps

- A literal `v` prefix (`questions-table.tsx:111` and four more).
- `join(", ")` instead of `formatList` (`version-history.tsx:211`, `rule-targets.tsx:113`, `:186`).
- Literal `·` separators (`forms/[formId]/page.tsx:174`, `form-page-header.tsx:148`).
- Step ids shown as titles (`version-view.tsx:138-142`).
- One form with three names on one screen: the title in the rail, the slug in the heading, the id in the tab (`page-title.ts:34-36`). Live, the tab read "Releases: frm_sample_library - QCMS".

### A23. Low · Code: smaller items

- Duplicate publish rejection lists with a duplicate `id` (`form-actions.tsx:186-205`).
- "This form has no draft" shown for an empty draft (`form-actions.tsx:104-105`).
- A rollback message that says "again" for a first release there (`apps/admin/lib/i18n/en.ts:1590`).
- A "Released" column in version history that means "ever reached".
- The rules empty state does not use `EmptyState`.
- The erasure log's Form cell is not a link.
- Owning workspace not visible anywhere. Deferred by `docs/features/068-workspace-model.md:49` until 069.

### A24. Low · Live: the harness prints the first admin's password to stdout

`scripts/compose-e2e.mjs:570-576` prints it by design for local runs, and suppresses it on CI. It is temporary and forced to change at first sign-in, and the stack binds to loopback. Still, a terminal log or a redirected log file now holds a live credential until that first sign-in. Consider printing the path of `.e2e-full-stack-credentials.json`, which CI already does, instead of the value.

## 5. Status of `plan/admin-ux-audit.md`

| Item                                                      | Status                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.1 rider, kit tables could not open in a new tab        | Fixed (`forms-table.tsx:76-84`, `questions-table.tsx:95-100`)                                                                                   |
| §3.1 element 5, per-row actions on the library lists      | Still open (a suggestion, not a defect)                                                                                                         |
| §3.2 question versions in a rail                          | Done                                                                                                                                            |
| §4.4 builder opts out of `FormPageHeader`                 | Now intentional (`form-page-header.tsx:48-53`), but the two identity lines use two formats                                                      |
| §4.5 retarget is a plain dialog                           | Still open, and now breaks `plan/admin-design-contracts.md:611-616`                                                                             |
| §4.6 rider #586, failed validate said "No issues"         | Fixed                                                                                                                                           |
| §5.5 Validation stays on the builder                      | Holds                                                                                                                                           |
| §6 width per route                                        | Done; `/webhooks` still differs from its drawing, as recorded                                                                                   |
| D1 #537 two `h1`s on version detail                       | Fixed. Every page also carries a hidden "JavaScript is required" `h1` inside a `display: none` panel, which is harmless to assistive technology |
| D1 #536 static `<title>`                                  | Fixed                                                                                                                                           |
| D2 #540 heading gap in version history                    | Fixed                                                                                                                                           |
| D7 #550, #551                                             | Fixed                                                                                                                                           |
| §8 items 5 and 6, ownership grid and ambient save         | Done                                                                                                                                            |
| §8 item 9, "a heading names its entity" as a written rule | Partly done: pinned by test, not written into the contracts                                                                                     |

## 6. Done well

- **Measured accessibility:** Lighthouse 100 on every page tried. All text comes from the catalog. Focus is managed on step change, branch insertion and roster change. Error summaries name the question and the instance.
- **The live branch notice** ("1 question was added below") is exactly what a screen-reader user needs, and visible to everyone else.
- **Resume on reload works:** the name typed on step 1 survived a reload.
- **Release history:** it records who, when, from where and approval, marks rollbacks in words, and warns before a rollback.
- **The erasure dialog** states its three consequences separately, needs a typed confirmation, and keeps a tombstone.
- **Auth hardening is humane:** forced change, TOTP with a text alternative to the QR code, one-time recovery codes with a copy button, and a single generic sign-in error.
- **Secure-links screen:** its scope sentence, one-time reveal and failed-read handling are the model the rest of the environment work should follow.

## 7. Decisions for the Code Owner

1. **Regional default locale** for both apps (P5, A9, ADR-27).
2. **Exclusive options** in the domain model (P6). This is an ADR and schema change.
3. **Resume through a reused secure link** (P11, SEC-2).
4. **A review step before Submit**, or correct the 076 documents (P14).
5. **Undo or confirm on instance removal** (P17, ADR-43).
6. **A shorter erasure confirmation token** (A21).

Everything else fits inside existing decisions.

## 8. Not covered, and suggested next pass

- The no-JavaScript path (P3, P8, P22) with scripting disabled.
- Phone-width layouts and the table-to-cards reflow.
- An NVDA pass over the step flow (P10).
- Authoring and previewing a repeating group end to end (A2, A15).
- Minting and redeeming secure links across environments (P11, P12).

Each of these needs the browser window visible, so that screenshots can be attached.
