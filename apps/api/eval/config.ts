import { AGENT_THINKING, type AgentThinking } from "../src/config.js";

/**
 * Eval tooling configuration, not product configuration: the product resolves its model from
 * the environment and bakes in no id.
 */
export const DEFAULT_MODEL = "claude-opus-5-5";

export const DEFAULT_GRADER_MODEL = "claude-sonnet-5-5";

/** Input, output and cache writes across one run; cache reads are reported on their own line. */
export const DEFAULT_MAX_TOKENS = 3_000_000;

export const DEFAULT_REPS = 3;

export interface EvalConfig {
  readonly model: string;
  readonly graderModel: string;
  readonly maxTokens: number;
  readonly reps: number;
  readonly thinking: AgentThinking;
}

export type EvalEnv = Readonly<Record<string, string | undefined>>;

function text(env: EvalEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? fallback : value;
}

function count(env: EvalEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number above zero`);
  }
  return value;
}

function thinking(env: EvalEnv): AgentThinking {
  const raw = text(env, "QCMS_EVAL_THINKING", "off");
  const found = AGENT_THINKING.find((value) => value === raw);
  if (found === undefined) {
    throw new Error(`QCMS_EVAL_THINKING must be one of ${AGENT_THINKING.join(", ")}`);
  }
  return found;
}

export function evalConfig(env: EvalEnv): EvalConfig {
  return {
    model: text(env, "QCMS_EVAL_MODEL", DEFAULT_MODEL),
    graderModel: text(env, "QCMS_EVAL_GRADER_MODEL", DEFAULT_GRADER_MODEL),
    maxTokens: count(env, "QCMS_EVAL_MAX_TOKENS", DEFAULT_MAX_TOKENS),
    reps: count(env, "QCMS_EVAL_REPS", DEFAULT_REPS),
    thinking: thinking(env),
  };
}
