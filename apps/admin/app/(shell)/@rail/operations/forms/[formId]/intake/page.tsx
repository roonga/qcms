import { OperationsFormRailSlot } from "../rail-slot";

/** The rail on one form's intake. */
export default function OperationsIntakeRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="intake" />;
}
