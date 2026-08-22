# What binds the portal

**Status:** authoritative. Check this document before citing a portal rule.

**Audience:** respondents, on browsers nobody chose, often reached by a link they were sent.

---

## Operation without JavaScript

**The no-JS path is required.** Every respondent flow completes with scripting disabled,
including submission (task 044). The e2e suite covers it, and
`docs/COMPONENT_GUIDELINES.md` makes no-JS coverage binding for any input control.

## Rule evaluation

**R2.** The browser never talks to the API directly, and the portal never evaluates rules. It
renders projections the API computed. This is a correctness boundary.

## Navigation and answers

**ADR-28.** Explicit Continue, Back and Submit. No collapse-on-answer and no derived cursor.

**ADR-31.** Answer commitment semantics: when a control's value is committed, and that an
emptied control reports **absence** rather than an empty string or an empty array.

## Appearance

**ADR-30.** Managed themes. Appearance is operator-configurable, and the portal's tokens live
in `packages/ui/src/theme.css`.

## Accessibility

**WCAG 2.2 AA is a floor.** Task **030**'s manual screen-reader pass is a Code Owner human
gate on this app.

## Internationalization

**ADR-27.** No hardcoded user-facing strings. Copy lives in the message catalogue and
formatting is locale-aware.

## Security

**SEC-1 to SEC-13**, verified as a system by task 040, whose sign-off is a launch gate. Two
that shape portal work directly:

- **The origin belt** refuses cross-origin state-changing requests, and every refusal writes
  one structured log line so a locked-out respondent is countable.
- **SEC-13** is a strict allowlist on anything logged or exported: no answers, no PII, no
  secrets.

## Input controls

**`docs/COMPONENT_GUIDELINES.md` is binding** for adding or changing any input control:
vendoring fidelity, the registry and adapter contract, the ADR-31 commit moment, and
conformance, keyboard, no-JS and focus coverage.
