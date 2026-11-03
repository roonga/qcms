import { FormRailSlot } from "../rail-slot";

export default function FormWebhooksRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "webhooks" }} />;
}
