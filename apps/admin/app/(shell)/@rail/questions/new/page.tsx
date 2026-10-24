import { NewQuestionRail } from "@/components/questions/new-question-rail";
import { blankDefinition } from "@/lib/questions/definition";
import { questionPanels } from "@/lib/questions/panels";
import { appLocale } from "@/lib/server/config";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The creation screen's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * ## The one thing this slot decides
 *
 * The panels of the document the screen OPENS with, so the first paint carries the rows
 * rather than filling them in after hydration. It derives them from the same
 * `blankDefinition("shortText", "")` the page hands the editor, through the same
 * `questionPanels` the editor derives its own sections from - so a row cannot name a panel
 * the card below has nothing to open, which is the property `lib/questions/panels.ts` exists
 * for.
 *
 * `withPreview` is left off, as it is on the page: there is no stored version for the API to
 * compile, so a Preview row would open a panel with nothing in it.
 *
 * From the first keystroke the editor's own live panels replace these, which is why the rail
 * component is a client one - the type is chosen on this screen and it decides which panels
 * exist. This slot's job ends at the first paint.
 */
export default async function NewQuestionRailSlot() {
  await requireAdminSession();
  return <NewQuestionRail panels={questionPanels(blankDefinition("shortText", ""), { locale: appLocale() })} />;
}
