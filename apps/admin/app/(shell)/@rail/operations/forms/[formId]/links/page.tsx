import { OperationsFormRailSlot } from "../rail-slot";

/** The rail on one form's secure links. */
export default function OperationsLinksRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="links" />;
}
