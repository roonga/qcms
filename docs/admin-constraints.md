# What binds the admin

**Status:** authoritative. Check this document before citing an admin rule.

**Audience:** authenticated staff, on machines they chose, in a session they signed into.

---

## Design

**The POCs are the design.** `plan/admin-shell-poc/*.html` holds one POC per screen, and each
is the approved design for its screen. Where a POC and `plan/admin-design-contracts.md`
disagree, the POC wins and the contract changes.

`plan/admin-design-contracts.md` remains useful as description, as rationale for why shipped
code looks as it does, and as a fallback for a screen no POC covers. It does not overrule a
drawing.

**There are no design or technical limits beyond the POCs.** JavaScript is available and a
design may depend on it.

## Accessibility

**Aim for WCAG 2.2 AA.** It is a goal the admin builds toward and a legitimate reason to
prefer one design over another. It is not a blocking gate: no admin PR parks on it.

The accessible option wins where it is available at reasonable cost. Where it is not, the
trade is stated rather than left silent.

## Internationalization

**ADR-27.** No hardcoded user-facing strings. Copy lives in the message catalogue and
formatting is locale-aware.

## Security

**SEC-1 to SEC-13**, verified as a system by task 040, whose sign-off is a launch gate. Two
that shape admin work directly:

- **SEC-1** forbids a catch-all mount, which is why the API mounts `auth.handler` behind an
  explicit endpoint allowlist.
- **SEC-13** is a strict allowlist on anything logged or exported: no answers, no PII, no
  secrets.

## Architecture

**ADR-35 as amended.** The admin holds no database handle. better-auth lives in the API, and
the admin reaches it over HTTP inside the ordinary admin-session gate.

The admin's auth screens keep named route handlers so the flow is not moved into client
JavaScript and the endpoint set is not republished. This is a constraint on that flow.

## Semantics

**An anchor navigates, a button acts.** A row that goes to another route is an anchor, which
is what makes open-in-new-tab work. A control that acts on the current page is a button.
