import { FormRailSlot } from "../rail-slot";

export default function FormPublishRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "publish" }} />;
}
