---
"create-qcms-app": patch
---

Scaffold the portal's locale constant and format module (ADR-27, issue #729).

The scaffolded portal carried the asymmetry the canonical one did: a catalog whose header
says a second locale is a new catalog module, and a receipt timestamp that inlined
`toLocaleString("en-US", ...)` inside `components/completion-view.tsx`, so an adopter
adding a locale had to edit a component and had no constant to swap. The templates now
carry `apps/portal/lib/i18n/format.ts`, exporting `PORTAL_LOCALE` and the receipt
formatter, which is the mirror of the admin's `lib/i18n/format.ts` an adopter already
receives.

Two call sites moved onto it: the completion receipt, and the `locale` prop the scripted
and no-JS step views hand `A2UIStepRenderer`, which feeds react-aria's `I18nProvider` and
was previously left to that package's own `en-US` default.

A scaffolded respondent reads exactly what they read before. For every value the portal
renders, `en` and `en-US` resolve to the same CLDR data, so the date shape, the date
field's segment order and the receipt's zone name are unchanged; only the place the tag
is named moved. This is the regeneration `pnpm qcms:sync-templates` produces rather than
a separate authoring pass.
