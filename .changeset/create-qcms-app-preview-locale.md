---
"create-qcms-app": patch
---

Scaffold the admin previews with the locale they render on (issue #906).

A scaffolded admin carried the defect the canonical one did: its three preview surfaces
(`components/forms/draft-preview.tsx`, `components/forms/version-view.tsx` and
`components/questions/question-preview.tsx`) passed no `locale` to `A2UIStepRenderer`, so
each inherited `@roonga/qcms-ui`'s own `en-US` default into react-aria's `I18nProvider` while
the scaffolded app declared `en` and its portal passed `en` to the same renderer. An
adopter previewing a form therefore had a date field, a calendar and a set of stepper
announcements resolved from a tag their app never chose.

The templates now carry `PREVIEW_LOCALE` in `apps/admin/lib/i18n/format.ts`, declared once
and passed at all three sites, so an adopter adding a locale has one declaration to move
rather than three call sites to find.

Nothing a scaffolded author reads changes. For everything a compiled A2UI step contains,
`en` and `en-US` resolve the same CLDR data, so the date field's segment order, its
placeholders and the number field's formatting are unchanged; only the place the tag is
named moved. This is the regeneration `pnpm qcms:sync-templates` produces rather than a
second implementation.
