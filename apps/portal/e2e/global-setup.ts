import { startApiProcess } from "./support/api-process-control.js";
import { startOtlpDeliveryRecord } from "./support/otlp-delivery.js";
import { startOtlpReceiver } from "./support/otlp-receiver.js";

export default async function globalSetup(): Promise<void> {
  startOtlpDeliveryRecord();
  await startOtlpReceiver();
  await startApiProcess();
}
