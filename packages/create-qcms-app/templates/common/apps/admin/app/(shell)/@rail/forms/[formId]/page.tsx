import { FormRailSlot } from "./rail-slot";

export default function FormBuilderRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "builder" }} />;
}
