import { FormRailSlot } from "../../rail-slot";

export default function FormResponseDetailRail({
  params,
}: {
  readonly params: Promise<{ formId: string; sessionId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "responses" }} />;
}
