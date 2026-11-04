import { FormRailSlot } from "../../rail-slot";

export default function FormVersionDetailRail({
  params,
}: {
  readonly params: Promise<{ formId: string; version: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "versions" }} />;
}
