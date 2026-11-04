import { NewQuestionRail } from "@/components/questions/new-question-rail";
import { blankDefinition } from "@/lib/questions/definition";
import { questionPanels } from "@/lib/questions/panels";
import { appLocale } from "@/lib/server/config";
import { requireAdminSession } from "@/lib/server/session";

export default async function NewQuestionRailSlot() {
  await requireAdminSession();
  return (
    <NewQuestionRail
      panels={questionPanels(blankDefinition("shortText", ""), { locale: appLocale() })}
    />
  );
}
