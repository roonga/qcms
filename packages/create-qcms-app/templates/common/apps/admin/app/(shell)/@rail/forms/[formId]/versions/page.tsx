import { FormRailSlot } from "../rail-slot";

export default function FormVersionsRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "versions" }} />;
}
