import type { BuilderSelection } from "@/lib/forms/builder-bridge";
import type { DraftStep } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

export function currentScreenName(
  selection: BuilderSelection | undefined,
  steps: readonly DraftStep[],
): string {
  if (selection === undefined || selection.kind === "form") return t("forms.tab.builder");
  const step = steps.find((candidate) => candidate.stepId === selection.stepId);
  if (step === undefined) return t("forms.tab.builder");

  if (selection.kind === "group") {
    const group = step.items.find(
      (item) => "groupId" in item && item.groupId === selection.groupId,
    );
    if (group !== undefined && "label" in group) {
      const label = textOf(group.label);
      return label === "" ? t("forms.group.untitled") : label;
    }
  }
  const title = textOf(step.title);
  return title === "" ? t("forms.steps.untitled") : title;
}
