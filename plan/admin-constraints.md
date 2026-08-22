# What binds the admin

**Status:** drafted by the PM/PO seat, 2026-08-22, after a portal constraint was imported
into an admin decision and shipped. Proposed for `docs/`; drafted in `plan/` because that is
this seat's grant. **This document exists to be checked before a rule is cited in an admin
decision.**

**Audience:** authenticated staff, on machines they chose, in a session they signed into.
That sentence is the reason most of the portal's constraints do not reach here.

---

## The rule that produced this document

On 2026-08-21 this seat told a lane that the Settings rail *"must remain usable without JS"*,
calling it a floor rather than a design preference. **There has never been a no-JS
requirement in the admin.** `docs/PROJECT_GOAL.md:339` scopes that path to *"the browsers an
institutional or government **respondent** runs"* - the portal. The lane obeyed correctly and
built fragment anchors with `:target` where its POC draws buttons calling a panel switcher.

> **A constraint proven for the portal does not transfer to the admin.** Before citing a rule
> in an admin decision, find where it is *stated* and read what it is scoped to. A sentence
> that names respondents is not about staff.

---

## What binds the admin

**The POCs are the design.** `plan/admin-shell-poc/*.html`, one per screen, are the approved
design (Code Owner, 2026-08-22). Where a POC and `plan/admin-design-contracts.md` disagree,
**the POC wins and the contract changes.** The contracts remain useful as description and as
a fallback for a screen no POC covers.

**WCAG 2.2 AA.** Binds both apps. A standing non-negotiable in this seat's charter, a Code
Owner human gate at task 030, and §8's own ruling states that "different apps" never licensed
a different accessibility standard.

**ADR-27.** No hardcoded user-facing strings; locale-aware formatting. Binds both apps.

**SEC-1 to SEC-13.** Security controls, verified as a system by task 040, whose sign-off is a
launch gate. SEC-1's no-catch-all rule shapes the auth mount; SEC-13's allowlist shapes what
may be logged or exported.

**Authenticated-session architecture** (ADR-35 as amended). The admin holds no database
handle; better-auth lives in the API. The admin's auth screens keep named route handlers for
that reason - an architecture constraint on that flow, **not** a general no-JS rule.

---

## What does NOT bind the admin

**No-JS operation.** JavaScript is available. A design may depend on it.

**All design and technical limits are removed** (Code Owner, 2026-08-22). No contract
constrains an admin screen against its own POC.

**Portal-derived reasoning of any kind** unless independently established here: unknown
browsers, respondent device profiles, ADR-28's step navigation, R2's no-rule-evaluation rule,
the managed-theme model (ADR-30), and the respondent-facing threat model.

---

## The distinction that keeps being confused

**Anchors versus buttons is not a no-JS question.** An anchor is the right element for a row
that navigates to another **route**, because that is what an anchor means and it is what
makes open-in-new-tab work. A button is right for a control that **acts** on the page. Both
hold with JavaScript freely available, and #570's kit-table work stands on that basis rather
than on scripting being off.
