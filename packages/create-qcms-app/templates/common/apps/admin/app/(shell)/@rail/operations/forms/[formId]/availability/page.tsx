import { OperationsFormRailSlot } from "../rail-slot";

/** The rail on one form's availability. */
export default function OperationsAvailabilityRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="availability" />;
}
