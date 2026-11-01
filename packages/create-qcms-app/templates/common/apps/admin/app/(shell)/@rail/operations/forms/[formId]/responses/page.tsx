import { OperationsFormRailSlot } from "../rail-slot";

/** The rail on one form's response list. */
export default function OperationsResponsesRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="responses" />;
}
