import { OperationsFormRailSlot } from "../rail-slot";

/** The rail on one form's known-target erasure. */
export default function OperationsEraseRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="erase" />;
}
