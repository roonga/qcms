import { SettingsSectionRail } from "@/components/settings-section-rail";
import { requireAdminSession } from "@/lib/server/session";
import { settingsSectionFromParams } from "@/lib/settings-sections";

/**
 * The Settings rail (issue 562, rebuilt to its POC by issue 655).
 *
 * ## Why a slot rather than something the Settings page renders
 *
 * The rail is a **sibling** of the capped content column, not a child of it. `<main>`'s width
 * is capped per route (issue 558) and that cap is a question about the CONTENT column, so a
 * rail nested inside it would quietly take 240px off the measure Settings was assigned and
 * stand the rail on `<main>`'s padding rather than on the shell's edge. The shell layout
 * cannot render it either: a Next layout is never told which child route matched. A parallel
 * route resolves both - this file is matched against the same URL as the Settings page and
 * renders beside `<main>` instead of inside it. Issue 559 established the slot and
 * `@rail/default.tsx` returns nothing, so every screen without one renders exactly as it did.
 *
 * ## The one page in this tree that is not the form-subtree rail's
 *
 * The slot holds nine pages: eight under `@rail/forms/[formId]/`, which all delegate to the
 * shared `rail-slot.tsx`, and this one. **This file deliberately does not use that helper,
 * and could not.** `rail-slot.tsx` loads a form's steps and issue counts and renders
 * `FormSubtreeRail`, which navigates between ROUTES. This rail switches which panel of one
 * route is on screen. The two share the directory and the 240px track and nothing else.
 *
 * ## Why it reads the query
 *
 * The rail and the panels are two React trees rendered from one URL, and both have to agree
 * about which section the screen opens with or the first paint would show one section marked
 * and another displayed. Rather than pass the answer between them, each asks the same pure
 * function about the same URL (`settingsSectionFromParams`). After the first paint the reader
 * is the one deciding, through the switch in `lib/settings-panel.ts`.
 *
 * ## Why it is a `page.tsx` with a session call and no data
 *
 * There is no per-account data in this rail: three fixed sections and nothing else, so unlike
 * the eight form-scoped slots there is nothing to load and no `loadFormRail` call.
 * `requireAdminSession()` is still called, and not as ceremony: a slot is a route segment of
 * its own, and while the `(shell)` layout gates the page beside it, this component is
 * rendered by the same request and should not be the one place in the shell that renders
 * authenticated chrome without asking.
 */
export default async function SettingsRail({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <SettingsSectionRail initial={settingsSectionFromParams(await searchParams)} />;
}
