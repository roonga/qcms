import type { Metadata } from "next";

import { t } from "./i18n/en.ts";

/**
 * The browser-tab title of one admin route (issue #536).
 *
 * ## What was wrong
 *
 * `app/layout.tsx` set one static `title` and no route in the app defined
 * `generateMetadata`, so `/forms`, `/questions`, `/settings`, every section of every form
 * and every detail route all produced the same tab text. Issue #510 fixed the `<h1>` half
 * of that complaint - a screen-reader user gets the right landmark heading - and left the
 * tab strip untouched, which is the half a sighted operator with six tabs open reads.
 *
 * ## One pattern, decided once
 *
 * Every title is `<page name> - QCMS` (`app.pageTitle`), and every page name comes from
 * the catalog rather than from a literal, because ADR-27 is binding and a title is
 * user-facing text like any other. The argument for the ordering is on that key.
 *
 * List routes get one as well as entity routes. The issue asks the question and the
 * answer is that the defect it describes is not specific to entities: `/forms` and
 * `/questions` were as indistinguishable from each other as two responses were.
 *
 * ## Titles are composed from route params, never from a fetch
 *
 * `generateMetadata` runs beside the page rather than inside it, so anything it wants
 * that the params do not carry is a second upstream read of the same resource. Naming a
 * tab is not worth doubling `GET /admin/forms/{id}` on ten screens, and a title derived
 * from params also survives the failure paths: a form that 404s still renders its route's
 * error state under a tab that says which form it was.
 *
 * The cost is that a form appears as `frm_life_insurance` rather than `Life insurance`.
 * That is the identifier the address bar is already showing, it is permanent (R6), and it
 * is what the section screens' own breadcrumb resolves against.
 *
 * ## Where the pattern is enforced
 *
 * `lib/page-title.test.ts` walks the route tree the way `lib/rail-routes.test.ts` does
 * and fails when a page has no `generateMetadata` or builds one without going through
 * here, so a route added without a title cannot ship quietly.
 */

/** The six sections of one form, as `forms.tab.*` names them. */
export type FormSection = "builder" | "preview" | "versions" | "links" | "responses" | "webhooks";

/** One route's metadata: its page name, in the app's one title pattern. */
export function pageMetadata(page: string): Metadata {
  return { title: t("app.pageTitle", { page }) };
}

/**
 * The page name for one of a form's section screens: `Version history: frm_life_insurance`.
 *
 * The section's name comes from the same `forms.tab.*` key the rail row, the last
 * breadcrumb crumb and the screen's own `<h1>` read, so a section cannot end up called one
 * thing in the tab and another on the page.
 */
export function formSectionName(section: FormSection, formId: string): string {
  return t("title.formSection", { section: t(`forms.tab.${section}`), formId });
}
