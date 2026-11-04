import { OperationsFormRailSlot } from "../../rail-slot";

/**
 * Marks Responses: one collected response is not a rail row. The rail carries no action,
 * so the erasure door stays in the main column.
 */
export default function OperationsResponseDetailRail({
  params,
}: {
  readonly params: Promise<{ formId: string; sessionId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="responses" />;
}
