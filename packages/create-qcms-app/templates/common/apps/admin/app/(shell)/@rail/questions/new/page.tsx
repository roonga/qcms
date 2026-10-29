import { NewQuestionRail } from "@/components/questions/new-question-rail";
import { blankDefinition } from "@/lib/questions/definition";
import { questionPanels } from "@/lib/questions/panels";
import { appLocale } from "@/lib/server/config";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question creation screen's rail. Derives the opening document's panels from the same
 * definition and function the editor uses, so no row can name a panel the card cannot open.
 * `withPreview` is off: there is no stored version to compile.
 */
export default async function NewQuestionRailSlot() {
  await requireAdminSession();
  return (
    <NewQuestionRail
      panels={questionPanels(blankDefinition("shortText", ""), { locale: appLocale() })}
    />
  );
}
