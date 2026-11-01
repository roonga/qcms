import { OperationsFormRailSlot } from "../rail-slot";

/** The rail on one form's endpoints and their deliveries. */
export default function OperationsWebhooksRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="webhooks" />;
}
