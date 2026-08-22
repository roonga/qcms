import { SettingsSectionRail } from "@/components/settings-section-rail";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The §7a rail on the Settings screen (issue 562).
 *
 * ## Why a slot rather than something the Settings page renders
 *
 * The rail is a **sibling** of the capped content column, not a child of it. `<main>`'s
 * width is capped per route (issue 558) and §6 asks that width question about the CONTENT
 * column, so a rail nested inside the cap would quietly take 240px off the measure Settings
 * was assigned and stand the rail on `<main>`'s padding rather than on the shell's edge.
 * The shell layout cannot render it either - a Next layout is never told which child route
 * matched. A parallel route is what resolves both: this file is matched against the same
 * URL as the Settings page and renders beside `<main>` instead of inside it. Issue 559
 * established the slot and `@rail/default.tsx` returns nothing, so every screen without one
 * renders exactly as it did.
 *
 * ## The one page in this tree that is not §7's
 *
 * After issue 561 the slot holds nine pages: eight under `@rail/forms/[formId]/`, which all
 * delegate to the shared `rail-slot.tsx`, and this one. **This file deliberately does not
 * use that helper, and could not.** `rail-slot.tsx` loads a form's steps and issue counts
 * and renders `FormSubtreeRail`, which is §7's contract: navigation between routes. §7a is
 * a different contract on the same grid column - same-page section anchors for one route -
 * so the two share the directory and nothing else. Sitting beside eight siblings makes that
 * easier to miss than it was when there were two, which is why it is written here.
 *
 * ## Why it is a `page.tsx` with a session call and no data
 *
 * There is no per-account data in this rail: §7a gives it three fixed section anchors and
 * forbids it anything else, so unlike the eight form-scoped slots there is nothing to load
 * and no `loadFormRail` call. `requireAdminSession()` is still called, and not as ceremony - a slot is
 * a route segment of its own, and while the `(shell)` layout gates the page beside it, this
 * component is rendered by the same request and should not be the one place in the shell
 * that renders authenticated chrome without asking. It costs a session read that the layout
 * has already made and it keeps the rule "everything under `(shell)` asks" free of an
 * exception someone would have to remember.
 */
export default async function SettingsRail() {
  await requireAdminSession();
  return <SettingsSectionRail />;
}
