import { t } from "../i18n/en.ts";
import { OPERATIONS_PATH } from "./modes.ts";

export interface AreaRailItem {
  readonly key: string;
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
}

export type OperationsRailCurrent = "forms" | "delivery-failures" | "erasure-log";

export const OPERATIONS_QUEUE_PATHS = {
  "delivery-failures": "/webhooks",
  "erasure-log": "/responses/erasures",
} as const;

/**
 * The Operations area's tree. The installation-wide queues show only to a caller who may
 * open them, and the screen being served is always drawn.
 */
export function operationsRailItems(
  current: OperationsRailCurrent,
  showQueues: boolean,
): readonly AreaRailItem[] {
  const items: AreaRailItem[] = [
    {
      key: "section:forms",
      href: OPERATIONS_PATH,
      label: t("rail.allForms"),
      current: current === "forms",
    },
  ];
  if (showQueues || current === "delivery-failures") {
    items.push({
      key: "queue:delivery-failures",
      href: OPERATIONS_QUEUE_PATHS["delivery-failures"],
      label: t("operations.queue.deliveryFailures"),
      current: current === "delivery-failures",
    });
  }
  if (showQueues || current === "erasure-log") {
    items.push({
      key: "queue:erasure-log",
      href: OPERATIONS_QUEUE_PATHS["erasure-log"],
      label: t("operations.queue.erasureLog"),
      current: current === "erasure-log",
    });
  }
  return items;
}
