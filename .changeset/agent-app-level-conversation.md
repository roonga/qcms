---
"qcms-api": patch
"qcms-admin": patch
---

One assistant conversation at the app level, which follows the operator across screens
(Code Owner, 2026-11-02, issue #1206). It replaces one conversation per form subtree or per
screen.

**The history is the dialogue.** What each side wrote, plus each settled card's own report.
A turn's screen facts are rebuilt by the API for the screen the turn names, so an earlier
screen's facts are dropped rather than carried and no answer value reaches the model however
far the conversation travels. The panel's context chip is the answer to which screen the
next turn will use.

**A waiting card expires when the operator leaves its screen or switches environment.** The
panel binds each card to the screen identity and environment it arrived on; the server stays
the authority, since the proposal token already binds that step's arguments and environment.

**Lifetime.** It survives navigation and a reload of the same tab, kept in that tab's
`sessionStorage` under the signed-in user's id: an entry naming another user is discarded and
the sign-out control clears it, because signing out does not clear tab storage on its own.
Nothing goes to `localStorage` and nothing is stored server-side. Past the length cap the
oldest turns drop and the panel says so.

**SEC-15 audited reads are keyed by the stay on a subject.** The admin mints a stay id
whenever the conversation arrives at a subject and sends it as `visitId`; the API adds it to
the dedup key, so a conversation that leaves a subject and returns writes a new `read` row. A
turn that names no stay keeps the conversation-wide key.
