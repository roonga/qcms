import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The creation screen's rail: a Header and nothing else (§7.0 ruling 6, Code Owner
 * 2026-10-24; issue #1117).
 *
 * ## A rail with one part in it is the ruling, not an oversight
 *
 * §7a used to make New form the example of a screen a rail would be empty on, and §7.0
 * ruling 6 answers that by name: "New form has a rail. It is not an exception." What it
 * carries is the way back, which ruling 3 makes the Header's job on every screen - so the
 * content column's own "Back to forms" link is gone and this is where it went.
 *
 * The point of the rail being here rather than only the link is the 240px track: the content
 * column's left edge is the same on this screen as on the library it came from and the
 * builder it leads to, so creating a form does not shift the page sideways under the author
 * doing it. That is the acceptance criterion the issue states first, and it is the reason a
 * screen with nothing to list still gets the frame.
 *
 * No Sections, because the creation form is one card with no panels to switch between; no
 * Filters, nothing to filter; no Actions, since the one act on this screen is Create, which
 * is in the form's own submit position where it belongs rather than in a navigation surface.
 *
 * It renders no `title` beyond the screen's own name and no tag: there is no subject yet.
 * That is the honest reading of "the subject's name" on a screen whose whole purpose is to
 * mint one.
 */
export default async function NewFormRail() {
  await requireAdminSession();
  return (
    <RailFrame
      subject={t("forms.create.title")}
      back={{ href: "/forms", label: t("forms.title") }}
      title={t("forms.create.title")}
      testId="qcms-new-form-rail"
    />
  );
}
