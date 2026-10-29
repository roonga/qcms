import { stopApiProcess } from "./support/api-process-control.js";
import { stopOtlpReceiver } from "./support/otlp-receiver.js";

export default async function globalTeardown(): Promise<void> {
  await stopApiProcess();
  await stopOtlpReceiver();
}
