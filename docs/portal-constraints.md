# What binds the portal

**Status:** drafted by the PM/PO seat, 2026-08-22, as the counterpart to
`docs/admin-constraints.md`. **This document exists so that a portal
rule is found here rather than inferred from an admin decision, and vice versa.**

**Audience:** respondents, on browsers nobody chose, often reached by a link they were sent.
That sentence is the reason the portal carries constraints the admin does not.

---

## What binds the portal

**The no-JS path.** `docs/PROJECT_GOAL.md:339` names its audience: *"the browsers an
institutional or government respondent runs, which is the audience WCAG 2.2 AA and the no-JS
path exist for"*. Task 044 delivered no-JS submission; the e2e suite covers it. **This is a
portal requirement and it does not extend to the admin.**

**R2.** The browser never talks to the API directly, and **the portal never evaluates rules**.
It renders projections the API computed. This is a correctness boundary, not a performance
one.

**ADR-28.** Explicit Continue / Back / Submit navigation. No collapse-on-answer, no derived
cursor. Task 045 established this after the derived-cursor model broke multi-choice and
regressed submit.

**ADR-31.** Answer commitment semantics - when a control's value is committed, and that an
emptied control reports **absence** rather than an empty string or empty array.

**ADR-30.** Managed themes. The portal's appearance is operator-configurable in a way the
admin's is not.

**WCAG 2.2 AA - a floor.** Hard here, and task **030**'s manual screen-reader pass is a Code
Owner human gate on this app. The admin **aims** at the same standard without it gating
(Code Owner, 2026-08-22); this app does not have that latitude, because its audience is
respondents on browsers nobody chose.

**ADR-27.** No hardcoded user-facing strings; locale-aware formatting. Binds both apps.

**SEC-1 to SEC-13**, including the origin belt whose refusals are now observable (#578), and
SEC-13's allowlist on anything logged or exported - no answers, no PII.

**`docs/COMPONENT_GUIDELINES.md`** is binding for adding or changing any input control:
vendoring fidelity, the registry/adapter contract, the ADR-31 commit moment, and
conformance / keyboard / **no-JS** / focus coverage.

---

## What does NOT bind the portal

**Admin design decisions.** The admin's POCs, `plan/admin-design-contracts.md`, the rail, the
per-route width caps and the admin table family are all admin-only. §8's ruling is that the
two are **different apps**: separate token vocabularies, and since 2026-08-22 explicitly
separate **constraints**.

**The admin's "no limits" ruling.** The Code Owner removed all design and technical limits on
the **admin** on 2026-08-22. That ruling is scoped to the admin and changes nothing here.

---

## The two floors that cross both apps

**WCAG 2.2 AA** and **ADR-27**. §8's ruling is explicit that "different apps" governs
spacing, type scale, visual density and - as widened on 2026-08-22 - constraints generally,
but *"does not license a different accessibility standard or a second way of handling
user-facing strings."*

Everything else should be established for the app it is being applied to, in that app's own
document, before it is cited.
