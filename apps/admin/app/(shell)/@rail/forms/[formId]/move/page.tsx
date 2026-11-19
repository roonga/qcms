import { FormRailSlot } from "../rail-slot";

export default function FormMoveRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "move" }} />;
}
