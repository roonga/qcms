import { OperationsFormRailSlot } from "../../rail-slot";

/**
 * The rail on one response's screen, marking Responses: one collected response is not a
 * row of the rail, which is the answer the section strip and the breadcrumb both gave on
 * this URL.
 *
 * The rail carries no action, so the erasure door stays in the main column and is never
 * reachable from a navigation surface.
 */
export default function OperationsResponseDetailRail({
  params,
}: {
  readonly params: Promise<{ formId: string; sessionId: string }>;
}) {
  return <OperationsFormRailSlot params={params} current="responses" />;
}
