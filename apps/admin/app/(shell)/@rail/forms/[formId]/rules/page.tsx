import { FormRailSlot } from "../rail-slot";

export default function FormRulesRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "rules" }} />;
}
