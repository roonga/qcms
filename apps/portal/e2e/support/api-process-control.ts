import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

interface ChildMessage {
  readonly type?: "ready" | "stopped" | "fatal";
  readonly error?: string;
}

let child: ChildProcess | undefined;

export async function startApiProcess(): Promise<void> {
  if (child !== undefined) return;
  const entry = fileURLToPath(new URL("./api-process-entry.ts", import.meta.url));
  const started = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    windowsHide: true,
  });
  child = started;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out starting the API process")),
      120_000,
    );
    started.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `API process exited before ready (code ${String(code)}, signal ${String(signal)})`,
        ),
      );
    });
    started.on("message", (message: ChildMessage) => {
      if (message.type === "ready") {
        clearTimeout(timeout);
        resolve();
      } else if (message.type === "fatal") {
        clearTimeout(timeout);
        reject(new Error(`API process failed during startup (${message.error ?? "Error"})`));
      }
    });
  }).catch((error: unknown) => {
    started.kill();
    child = undefined;
    throw error;
  });
}

export async function stopApiProcess(): Promise<void> {
  const current = child;
  child = undefined;
  if (current === undefined || current.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      current.kill();
      resolve();
    }, 15_000);
    current.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    current.send?.({ type: "shutdown" });
  });
}
