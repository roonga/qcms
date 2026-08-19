# ADR-39 (proposal): version-pinned public links

**Status:** proposal, PM/PO seat, 2026-08-19. **On hold - not to be promoted into
`docs/PROJECT_GOAL.md` until the scope freeze recorded in this session's transcript
is resolved.** R1 is a binding project rule protecting one of the three
non-negotiables (immutability); an ADR that amends it is not something this seat
signs off on unilaterally, freeze or no freeze - that was already true before the
freeze restated it. Nothing below is final. It reflects the mechanism discussed and
the per-version lifecycle refinement discussed, kept current so the actual decision,
whenever it's made through a channel with confirmed authority, has a complete
proposal to react to rather than starting from nothing.

## Context

Every session-creation path in QCMS resolves only to the newest published version,
by design, today:

- Anonymous start (`/f/{slug}`): `apps/api/src/features/responses/start-session/
  handler.ts:151` calls `getLatestPublishedVersion`. No version field exists on the
  request.
- Secure-link redemption: the same file, line 249, does the identical lookup after
  `verifySecureLink` succeeds. The signed token payload is `{formId, linkId,
  expiresAt, oneTime}` - no version claim (`apps/api/src/features/links/
  handler.ts:107-110`).
- The handler's own doc comment states this as intentional: `createSession` is "the
  sole path that sets a session's version," and it always sets the newest.

R1 (`PROJECT_INSTRUCTIONS.md:30`): "Published versions are immutable; sessions pin
the version they started on." As written, this rule is silent on what a *new*
session is allowed to pin to - in practice it has only ever meant "the newest," and
nothing enforces that beyond every call site happening to ask for it.

This was never proposed or rejected before this session (confirmed by grep across
`docs/RETRO.md`, the full ADR list, and GitHub issues - genuinely new ground, not a
revisit).

## Decision (capability, already confirmed)

Every published version of a form gets its own permanent, respondent-facing link.
Opening it starts a new session pinned to *that* version, indefinitely - not
whatever is newest at the time someone clicks it.

## Proposed mechanism

**A deterministic path, not a minted token.** `/f/{slug}/v{version}`, validated
server-side against: version `{version}` exists and is published for this form, and
the form is not closed. No new secret, no new database row, no expiry, no
revocation-by-default.

Rejected alternative: extending secure links with an optional `version` field on the
mint payload. Smaller code diff (the token/expiry/revoke machinery already exists),
but wrong shape for what was asked - a secure link is an operator-triggered,
expiring, optionally one-time *invitation*; what's wanted here is a *standing
address* that exists automatically the instant a version is published, with no mint
action. Using the token mechanism for this would mean either giving these links an
expiry they shouldn't have, or special-casing "no expiry" into a system whose whole
shape assumes one. The deterministic path costs nothing extra to keep working
forever, because there is nothing stored to expire.

**Still subject to the same gates as the plain public link:** the deployment's
challenge provider (ADR-24) and the same anti-abuse flagging (`HONEYPOT`,
`MIN_TIME`, `RATE_ANOMALY`, task 026). A version-pinned link is not a bypass of
either - it changes which version a session starts on, nothing about how the
session is allowed to start.

**Closed forms.** `FORM_CLOSED` refuses a version-pinned start exactly as it refuses
the plain one today - "closed" means no new sessions, full stop, not "no new
sessions on the newest version only." Consistent with R1's own framing of close/
reopen as gating *new sessions*, not gating a specific version.

**Erasure (ADR-17).** No interaction. Erasure operates on submitted responses by
session id, not on the version-start mechanism; nothing here changes what gets
erased or how.

## R1 amendment required

Current: "Published versions are immutable; sessions pin the version they started
on." Proposed addition, same rule, same section: **"A new session pins the newest
published version by default, or the version named by the link it was started
from, when that version is still published and the form is open."** This is an
addition, not a contradiction - immutability and pin-at-start both hold exactly as
written; what's new is which version a *new* session is allowed to pin to.

## Per-version link state (refines the gap originally flagged as out of scope)

The first draft of this proposal left "retire one old version's link without
closing the whole form" unsolved, with only "close the entire form" as the interim
lever. Discussed refinement: give each version's link its own independent state,
orthogonal to the form's own open/closed switch -

- **Open** (default). The link works exactly as the rest of this proposal
  describes. Nothing changes for an old version's link just because a newer one
  published - this has to be the default, or every publish would silently break
  every link minted before it.
- **Redirect.** The version's link (`/f/{slug}/v2`) issues a redirect to whatever
  the form's current newest version is, so a stale link forwards someone to live
  content instead of a dead end.
- **Closed, with a message.** The link stops starting new sessions and returns an
  explanatory response instead of a bare refusal - something closer to
  `FORM_CLOSED`'s existing shape than a generic 404.

This is one small piece of per-version state (open / redirect / closed), checked by
the same deterministic route before it decides whether to start a session, issue a
redirect, or return the message. It does not touch the whole-form open/closed
switch, does not need a token or a database row beyond that one state field per
version, and does not change anything else in this proposal - it only replaces
"close the whole form is the only lever" with a lever scoped to the version an
operator actually wants to retire.

**Still open:** where this state is set (the natural spot is next to each version's
link on the Version History screen, per the placement already proposed below) and
whether "redirect" needs its own confirmation dialog the way closing a form already
does (R1's "no one can start this form after it closes" framing suggests yes - this
changes where a request lands, which is the kind of thing this project's UI
convention states as a consequence before it happens, not silently).

## Explicitly out of scope for this proposal

- **Any change to secure links.** They are untouched - still the operator-minted,
  expiring, always-newest-at-redemption mechanism they are today. This is a
  parallel, third mechanism (plain public link, secure link, version-pinned link),
  not a replacement for either existing one.

## Admin UI (once this ADR is confirmed)

Per the placement decision already made: the Form builder screen, at the moment of
publishing. `forms.publish.published` ("Published as v{version}.") gets the
version's own permanent link shown alongside it, not just the version number. The
Version History screen (`/forms/{id}/versions`, already one row per version) is the
natural place to list every past version's link for later reference, and now also
the natural place for the per-version open/redirect/closed control described above -
the row already exists, this adds one control to it rather than a new screen. Not
required for a first cut (open-by-default with no control at all is a valid smaller
first slice), but the table already has the row to hang it on whenever it's wanted.

## Open questions for the Code Owner

The "revoke one version independently" gap has a proposed answer now (per-version
link state, above) rather than being deferred to "close the whole form." What
remains open:

- **Does redirect need its own confirm dialog**, matching the project's own pattern
  of stating a consequence before an irreversible-feeling change takes effect (the
  form close/reopen dialogs already do this)? Recommendation: yes, one sentence -
  "anyone with this version's link will land on v{newest} instead" - is enough; this
  is not the same weight as erasure and doesn't need type-to-confirm.
- **Does this need its own ADR line, or is it small enough to fold into ADR-39 as
  written** rather than becoming ADR-40? Recommendation: fold in - it's one field's
  worth of behavior on a mechanism this document already proposes, not a separable
  decision.
