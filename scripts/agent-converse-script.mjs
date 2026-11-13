// @ts-check
/**
 * Pure half of `pnpm agent:converse`: the conversation script, the per-message card directive,
 * secret redaction and the transcript's error roll-up. No browser and no filesystem, so
 * `scripts/agent-converse-script.test.ts` covers it without a model key or a running admin.
 */

export const DIRECTIVES = ["confirm", "decline", "leave"];

export const DEFAULT_DIRECTIVE = "leave";

export const DEFAULT_BASE_URL = "http://localhost:7040";

export const DEFAULT_SCREEN = "/questions";

export const DEFAULT_RUN_NAME = "agent-converse";

export const DEFAULT_TIMEOUT_MS = 180_000;

/** A minted link carries its own opaque address, so it leaves the transcript the way a revealed secret does. */
const LINK_ADDRESS =
  /https?:\/\/[A-Za-z0-9.:-]+(?:\/[A-Za-z0-9._~-]+)*\/[A-Za-z0-9_-]{16,}\/?(?![A-Za-z0-9_-])/g;

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {string}
 */
export function asDirective(value, where) {
  if (typeof value === "string" && DIRECTIVES.includes(value)) return value;
  throw new Error(
    `${where}: card directive must be one of ${DIRECTIVES.join(", ")}, got ${JSON.stringify(value)}`,
  );
}

/**
 * `--cards` binds to the `--ask` before it; given before any `--ask` it is the run's default.
 *
 * @param {readonly string[]} args
 * @returns {{ baseUrl?: string; screen?: string; formId?: string; scriptFile?: string; name?: string;
 *   timeoutMs?: number; headed: boolean; keepOpen: boolean; defaultCards?: string;
 *   asks: { text: string; cards?: string }[] }}
 */
export function parseArgs(args) {
  /** @type {{ text: string; cards?: string }[]} */
  const asks = [];
  /** @type {Record<string, unknown>} */
  const parsed = { headed: false, keepOpen: false };
  const remaining = [...args];

  /** @param {string} flag */
  const value = (flag) => {
    const next = remaining.shift();
    if (next === undefined) throw new Error(`${flag} requires a value`);
    return next;
  };

  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--base-url") parsed["baseUrl"] = value(arg);
    else if (arg === "--screen") parsed["screen"] = value(arg);
    else if (arg === "--form") parsed["formId"] = value(arg);
    else if (arg === "--script") parsed["scriptFile"] = value(arg);
    else if (arg === "--name") parsed["name"] = value(arg);
    else if (arg === "--headed") parsed["headed"] = true;
    else if (arg === "--keep-open") parsed["keepOpen"] = true;
    else if (arg === "--ask") asks.push({ text: value(arg) });
    else if (arg === "--timeout") {
      const ms = Number(value(arg));
      if (!Number.isFinite(ms) || ms <= 0) {
        throw new Error("--timeout requires a positive number of milliseconds");
      }
      parsed["timeoutMs"] = ms;
    } else if (arg === "--cards") {
      const directive = asDirective(value(arg), "--cards");
      const last = asks.at(-1);
      if (last === undefined) parsed["defaultCards"] = directive;
      else asks[asks.length - 1] = { ...last, cards: directive };
    } else throw new Error(`unknown option: ${arg}`);
  }
  return { .../** @type {never} */ (parsed), asks };
}

/**
 * @param {string} source
 * @param {string} where
 * @returns {{ baseUrl?: string; screen?: string; formId?: string; name?: string; timeoutMs?: number;
 *   cards?: string; messages: { text: string; cards?: string }[] }}
 */
export function parseScriptFile(source, where) {
  /** @type {unknown} */
  let loaded;
  try {
    loaded = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${where} is not valid JSON: ${detail}`, { cause: error });
  }
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new Error(`${where} must hold a JSON object with a "messages" array`);
  }
  const record = /** @type {Record<string, unknown>} */ (loaded);
  const listed = record["messages"];
  if (!Array.isArray(listed)) throw new Error(`${where} must hold a "messages" array`);

  const messages = listed.map((entry, index) => {
    const at = `${where}: messages[${String(index)}]`;
    if (typeof entry === "string") return { text: entry };
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${at} must be a string or an object`);
    }
    const message = /** @type {Record<string, unknown>} */ (entry);
    const text = message["text"];
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(`${at} needs a non-empty "text"`);
    }
    const cards = message["cards"];
    return cards === undefined ? { text } : { text, cards: asDirective(cards, at) };
  });

  /** @param {string} key */
  const str = (key) => (typeof record[key] === "string" ? { [key]: record[key] } : {});
  return {
    ...str("baseUrl"),
    ...str("screen"),
    ...str("formId"),
    ...str("name"),
    ...(typeof record["timeoutMs"] === "number" ? { timeoutMs: record["timeoutMs"] } : {}),
    ...(record["cards"] === undefined
      ? {}
      : { cards: asDirective(record["cards"], `${where}: cards`) }),
    messages,
  };
}

/**
 * @param {{ formId?: string; screen?: string }} source
 * @param {string} where
 * @returns {string | undefined}
 */
function screenOf(source, where) {
  if (source.screen !== undefined && source.formId !== undefined) {
    throw new Error(`${where} names two screens; give a form or a screen, not both`);
  }
  if (source.screen !== undefined) return source.screen;
  return source.formId === undefined ? undefined : `/forms/${source.formId}`;
}

/**
 * A per-message directive wins, then the run's own default, then the script file's, then `leave`.
 *
 * @param {{ cli: ReturnType<typeof parseArgs>; file?: ReturnType<typeof parseScriptFile>;
 *   environment?: Readonly<Record<string, string | undefined>> }} options
 * @returns {{ baseUrl: string; screen: string; name: string; timeoutMs: number; headed: boolean;
 *   keepOpen: boolean; messages: { text: string; cards: string }[] }}
 */
export function resolveRun({ cli, file, environment = {} }) {
  const configured =
    environment["QCMS_AGENT_CONVERSE_BASE_URL"] ?? environment["QCMS_ADMIN_BASE_URL"];
  const baseUrl = cli.baseUrl ?? file?.baseUrl ?? configured ?? DEFAULT_BASE_URL;
  const screen =
    screenOf(cli, "the command line") ??
    (file === undefined ? undefined : screenOf(file, "the script file")) ??
    DEFAULT_SCREEN;

  const fallback = cli.defaultCards ?? file?.cards ?? DEFAULT_DIRECTIVE;
  const scripted = cli.asks.length > 0 ? cli.asks : (file?.messages ?? []);
  if (scripted.length === 0) {
    throw new Error("no messages to send: pass --ask <text>, or --script <file> holding messages");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    screen: screen.startsWith("/") ? screen : `/${screen}`,
    name: cli.name ?? file?.name ?? DEFAULT_RUN_NAME,
    timeoutMs: cli.timeoutMs ?? file?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    headed: cli.headed,
    keepOpen: cli.keepOpen,
    messages: scripted.map((message) => ({ text: message.text, cards: message.cards ?? fallback })),
  };
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {{ email: string; password: string; totpSecret?: string }}
 */
export function resolveCredentials(environment) {
  const email = environment["QCMS_AGENT_CONVERSE_EMAIL"] ?? environment["QCMS_ADMIN_EMAIL"];
  const password =
    environment["QCMS_AGENT_CONVERSE_PASSWORD"] ?? environment["QCMS_ADMIN_PASSWORD"];
  if (email === undefined || email.trim() === "" || password === undefined || password === "") {
    throw new Error(
      "set QCMS_AGENT_CONVERSE_EMAIL and QCMS_AGENT_CONVERSE_PASSWORD (or QCMS_ADMIN_EMAIL and " +
        "QCMS_ADMIN_PASSWORD) to the admin this run signs in as",
    );
  }
  const totp = environment["QCMS_AGENT_CONVERSE_TOTP"];
  return {
    email: email.trim(),
    password,
    ...(totp === undefined || totp.trim() === "" ? {} : { totpSecret: totp.trim() }),
  };
}

/** Holds every one-time value out of the transcript and hands back the reference that replaces it. */
export function createSecretVault() {
  /** @type {{ ref: string; label: string; value: string }[]} */
  const entries = [];
  return {
    entries,
    /**
     * @param {string} label
     * @param {string} value
     * @returns {string}
     */
    hide(label, value) {
      const known = entries.find((entry) => entry.value === value);
      if (known !== undefined) return known.ref;
      const ref = `secret-${String(entries.length + 1)}`;
      entries.push({ ref, label, value });
      return ref;
    },
  };
}

/**
 * @param {string | null | undefined} text
 * @param {ReturnType<typeof createSecretVault>} vault
 * @param {string} label
 * @returns {string | null}
 */
export function redactAddresses(text, vault, label) {
  if (text === null || text === undefined) return null;
  return text.replace(LINK_ADDRESS, (address) => `[${vault.hide(`${label} address`, address)}]`);
}

/**
 * @param {string} hint
 * @returns {string | undefined}
 */
export function typedConfirmationValue(hint) {
  return /^Type (?<value>.+) exactly\.$/u.exec(hint.trim())?.groups?.["value"];
}

/**
 * A turn records every card the page showed. `card` is the one the directive acted on, kept so a
 * reader written against a single card still works; `scripts/agent-review/checks.mjs` reads both.
 *
 * @param {Record<string, unknown>} turn
 * @returns {Record<string, unknown>[]}
 */
export function cardsOf(turn) {
  const many = turn["cards"];
  if (Array.isArray(many)) {
    return many.filter((card) => card !== null && typeof card === "object");
  }
  const one = turn["card"];
  return one === null || typeof one !== "object"
    ? []
    : [/** @type {Record<string, unknown>} */ (one)];
}

/**
 * @param {Record<string, unknown>} card
 * @param {readonly Record<string, unknown>[]} cards
 * @returns {number}
 */
function cardIndex(card, cards) {
  return typeof card["index"] === "number" ? card["index"] + 1 : cards.indexOf(card) + 1;
}

/**
 * Only a card still waiting can be confirmed or declined, so a directive goes to that one rather
 * than to whichever card happens to be first in the page.
 *
 * @param {readonly Record<string, unknown>[]} cards
 * @returns {Record<string, unknown> | undefined}
 */
export function cardAwaitingConfirmation(cards) {
  return cards.find((card) => card["state"] === "proposed");
}

/**
 * @param {Record<string, unknown>} step
 * @param {Record<string, unknown>} card
 * @returns {string}
 */
function stepFailureText(step, card) {
  const notes = Array.isArray(step["notes"]) ? step["notes"].map(String) : [];
  const issues = Array.isArray(step["issues"])
    ? step["issues"].map((issue) => {
        const entry = /** @type {Record<string, unknown>} */ (issue);
        return `${String(entry["code"])}: ${String(entry["message"])}`;
      })
    : [];
  const reason = [...notes, ...issues];
  if (reason.length > 0) return reason.join(" / ");
  const result = card["result"];
  return typeof result === "string" && result !== ""
    ? result
    : "the step failed without saying why";
}

/**
 * Every failure the page shows, so a caller that cannot look at the screen still gets the reason.
 *
 * @param {{ turns: readonly Record<string, unknown>[] }} transcript
 * @returns {{ turn: number; where: string; text: string }[]}
 */
export function runErrors(transcript) {
  /** @type {{ turn: number; where: string; text: string }[]} */
  const errors = [];
  for (const [index, turn] of transcript.turns.entries()) {
    const at = index + 1;
    const panel = turn["panelError"];
    if (typeof panel === "string" && panel !== "")
      errors.push({ turn: at, where: "panel", text: panel });

    const replySteps = Array.isArray(turn["replySteps"]) ? turn["replySteps"] : [];
    for (const entry of replySteps) {
      const step = /** @type {Record<string, unknown>} */ (entry);
      if (step["state"] !== "failed" && step["state"] !== "interrupted") continue;
      errors.push({
        turn: at,
        where: `reply step "${String(step["label"])}"`,
        text: `the assistant reported this step ${String(step["state"])}`,
      });
    }

    const cards = cardsOf(turn);
    for (const view of cards) {
      const steps = Array.isArray(view["steps"]) ? view["steps"] : [];
      const which = cards.length > 1 ? `card ${String(cardIndex(view, cards))} ` : "";
      for (const [position, entry] of steps.entries()) {
        const step = /** @type {Record<string, unknown>} */ (entry);
        if (step["state"] !== "failed") continue;
        errors.push({
          turn: at,
          where: `${which}plan step ${String(position + 1)} "${String(step["title"] ?? view["title"])}"`,
          text: stepFailureText(step, view),
        });
      }
    }
  }
  return errors;
}
