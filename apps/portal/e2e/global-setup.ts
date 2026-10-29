import { startApiProcess } from "./support/api-process-control.js";
import { startOtlpDeliveryRecord } from "./support/otlp-delivery.js";
import { startOtlpReceiver } from "./support/otlp-receiver.js";
import { warmAdminFirstPaint } from "./support/warm-admin.js";

export default async function globalSetup(): Promise<void> {
  startOtlpDeliveryRecord();
  await startOtlpReceiver();
  await startApiProcess();
  // After the API, because the admin's first page is served by a BFF that reaches it.
  await warmAdminFirstPaint();
}
