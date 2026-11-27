import type { EvalEnv } from "./config.js";

export const KEY_VARIABLE = "QCMS_AGENT_API_KEY";

/** Word for word what `scripts/agent-eval.mjs` prints; `key.test.ts` fails on drift. */
export const KEY_MISSING_MESSAGE = "Set QCMS_AGENT_API_KEY to run the agent eval";

/** The key is held in memory for the run and never falls back to the fake provider. */
export function readApiKey(env: EvalEnv): string {
  const key = env[KEY_VARIABLE]?.trim();
  if (key === undefined || key === "") throw new Error(KEY_MISSING_MESSAGE);
  return key;
}

/**
 * The last reader before anything leaves the harness. An empty key would match every text,
 * so it is refused rather than passed.
 */
export function assertKeyFree(where: string, text: string, key: string): void {
  if (key === "") throw new Error(`${where} was checked against an empty key`);
  if (text.includes(key)) throw new Error(`${where} carries the ${KEY_VARIABLE} value`);
}

/** The JSON a result or a trace is written as, read for the key first. */
export function keyFreeJson(where: string, value: unknown, key: string): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  assertKeyFree(where, text, key);
  return text;
}
