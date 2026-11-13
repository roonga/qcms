#!/usr/bin/env node
// @ts-check
/**
 * Drives the admin authoring assistant from a script and writes back a machine-readable
 * transcript, so an agent can hold a conversation it can read without a person copying out of
 * a browser. Usage lives in `docs/DEVELOPER_GUIDE.md`.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";
import { generate } from "otplib";

import { cardHasSettled, isHydrated, readPanel } from "./agent-converse-page.mjs";
import {
  createSecretVault,
  parseArgs,
  parseScriptFile,
  redactAddresses,
  resolveCredentials,
  resolveRun,
  runErrors,
  typedConfirmationValue,
} from "./agent-converse-script.mjs";
import { scratchPath } from "./agent-scratch.mjs";

/** The admin stamps this only after its root commits; it must match `apps/admin/lib/hydration.ts`. */
const HYDRATED_ATTRIBUTE = "data-qcms-hydrated";

const VIEWPORT = { width: 1440, height: 960 };

const SETTLE_MS = 400;

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} timeoutMs
 */
async function hydrated(page, timeoutMs) {
  await page.waitForFunction(isHydrated, HYDRATED_ATTRIBUTE, { timeout: timeoutMs });
}

/**
 * Hydration can overwrite input typed before the root commits, so the value is read back.
 *
 * @param {import("@playwright/test").Locator} field
 * @param {string} value
 */
async function fillStable(field, value) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await field.fill(value);
    if ((await field.inputValue()) === value) return;
    await field.page().waitForTimeout(SETTLE_MS);
  }
  throw new Error("the field would not keep its value; is the admin still compiling this route?");
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ baseUrl: string; timeoutMs: number }} run
 * @param {{ email: string; password: string; totpSecret?: string }} credentials
 */
async function signIn(page, run, credentials) {
  await page.goto(`${run.baseUrl}/sign-in`, { waitUntil: "domcontentloaded" });
  await hydrated(page, run.timeoutMs);
  await fillStable(page.getByLabel("Email"), credentials.email);
  await fillStable(page.getByLabel("Password"), credentials.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/sign-in" || url.searchParams.has("error"), {
      timeout: run.timeoutMs,
    }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  const landed = new URL(page.url()).pathname;
  if (landed === "/sign-in") {
    const shown = await page
      .getByRole("alert")
      .first()
      .innerText()
      .catch(() => "");
    throw new Error(
      `the admin refused this sign-in: ${shown.trim() === "" ? "it showed no reason" : shown.trim()}`,
    );
  }
  if (landed.startsWith("/change-password")) {
    throw new Error(
      "this account still holds a provisional password: finish the first sign-in in a browser, " +
        "then put the new password in QCMS_AGENT_CONVERSE_PASSWORD",
    );
  }
  if (!landed.startsWith("/two-factor")) return;
  if (credentials.totpSecret === undefined) {
    throw new Error(
      `the admin asked for a second factor at ${landed}: set QCMS_AGENT_CONVERSE_TOTP to this ` +
        "account's TOTP secret, or run against a stack with QCMS_ADMIN_2FA=optional",
    );
  }
  await hydrated(page, run.timeoutMs);
  await fillStable(
    page.getByLabel(/Six-digit code/u),
    await generate({ secret: credentials.totpSecret }),
  );
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/two-factor"), { timeout: run.timeoutMs }),
    page.getByRole("button", { name: "Verify" }).click(),
  ]);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ baseUrl: string; screen: string; timeoutMs: number }} run
 */
async function openAssistant(page, run) {
  await page.goto(`${run.baseUrl}${run.screen}`, { waitUntil: "domcontentloaded" });
  await hydrated(page, run.timeoutMs);
  const panel = page.getByTestId("qcms-assistant-panel");
  if (!(await panel.isVisible())) await page.getByTestId("qcms-assistant-button").click();
  await panel.waitFor({ state: "visible", timeout: run.timeoutMs });
}

/**
 * The composer swaps Send for Stop while a turn streams, so a reply has settled once Send is back
 * and no streaming turn is left in the list.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} timeoutMs
 */
async function waitForReply(page, timeoutMs) {
  await page
    .getByTestId("qcms-assistant-stop")
    .waitFor({ state: "attached", timeout: 15_000 })
    .catch(() => undefined);
  await page.getByTestId("qcms-assistant-send").waitFor({ state: "attached", timeout: timeoutMs });
  await page
    .getByTestId("qcms-assistant-streaming")
    .waitFor({ state: "detached", timeout: timeoutMs });
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} timeoutMs
 */
async function waitForCardToSettle(page, timeoutMs) {
  await page.waitForFunction(cardHasSettled, undefined, { timeout: timeoutMs });
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} directive
 * @param {{ state: string | null; typedHint: string | null } | null} card
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function applyDirective(page, directive, card, timeoutMs) {
  if (card === null) return "no card";
  if (directive === "leave" || card.state !== "proposed") return "left as proposed";
  const shown = page.locator(".qcms-acard");

  if (directive === "decline") {
    await shown.getByRole("button", { name: "Cancel" }).click();
    await waitForCardToSettle(page, timeoutMs);
    return "declined";
  }

  if (card.typedHint !== null) {
    const required = typedConfirmationValue(card.typedHint);
    if (required === undefined) {
      throw new Error(
        `this card asks for a typed confirmation this run cannot read: ${card.typedHint}`,
      );
    }
    await fillStable(shown.locator(".qcms-acard__typed input"), required);
  }
  await shown.getByRole("button", { name: /^Confirm/u }).click();
  await waitForCardToSettle(page, timeoutMs);
  return "confirmed";
}

/**
 * @param {ReturnType<typeof readPanel>["card"]} card
 * @param {ReturnType<typeof createSecretVault>} vault
 * @param {number} turn
 */
function recordCard(card, vault, turn) {
  if (card === null) return null;
  return {
    ...card,
    result: redactAddresses(card.result, vault, `turn ${String(turn)} result`),
    steps: card.steps.map((step, index) => {
      const where = `turn ${String(turn)} step ${String(index + 1)}`;
      const { revealed, ...rest } = step;
      return {
        ...rest,
        details: redactAddresses(rest.details, vault, where),
        notes: rest.notes.map((note) => redactAddresses(note, vault, where)),
        revealed:
          revealed === null || revealed === ""
            ? null
            : { secret: true, ref: vault.hide(`${where} one-time value`, revealed) },
      };
    }),
  };
}

/**
 * @param {string} directory
 * @param {ReturnType<typeof createSecretVault>} vault
 * @returns {string | null}
 */
function writeSecrets(directory, vault) {
  if (vault.entries.length === 0) return null;
  const file = join(directory, "secrets.json");
  writeFileSync(file, `${JSON.stringify(vault.entries, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ screen: string; timeoutMs: number; messages: readonly { text: string; cards: string }[] }} run
 * @param {string} target
 * @param {ReturnType<typeof createSecretVault>} vault
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function converse(page, run, target, vault) {
  /** @type {Record<string, unknown>[]} */
  const turns = [];
  for (const [index, message] of run.messages.entries()) {
    const at = index + 1;
    await fillStable(page.getByTestId("qcms-assistant-composer"), message.text);
    await page.getByTestId("qcms-assistant-send").locator("button").click();
    await waitForReply(page, run.timeoutMs);

    const before = await page.evaluate(readPanel);
    const action = await applyDirective(page, message.cards, before.card, run.timeoutMs);
    const panel =
      action === "confirmed" || action === "declined" ? await page.evaluate(readPanel) : before;

    const shot = `turn-${String(at).padStart(2, "0")}.png`;
    await page.screenshot({ path: join(target, shot), fullPage: true });

    const reply = panel.turns.filter((turn) => turn.role === "assistant").at(-1);
    turns.push({
      turn: at,
      directive: message.cards,
      cardAction: action,
      screen: run.screen,
      context: panel.context,
      user: message.text,
      reply: redactAddresses(reply?.text ?? null, vault, `turn ${String(at)} reply`),
      thinking: reply?.thinking ?? [],
      replySteps: reply?.steps ?? [],
      card: recordCard(panel.card, vault, at),
      panelError: panel.panelError,
      screenshot: shot,
    });
  }
  return turns;
}

/**
 * @param {readonly string[]} args
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {string} directory
 * @returns {Promise<number>}
 */
export async function main(args, environment, directory) {
  const cli = parseArgs(args);
  const file =
    cli.scriptFile === undefined
      ? undefined
      : parseScriptFile(readFileSync(cli.scriptFile, "utf8"), cli.scriptFile);
  const run = resolveRun({ cli, file, environment });
  const credentials = resolveCredentials(environment);

  const target = scratchPath({ directory, environment, name: run.name, fresh: true });
  mkdirSync(target, { recursive: true });

  const vault = createSecretVault();
  const startedAt = new Date().toISOString();
  /** @type {Record<string, unknown>[]} */
  let turns = [];
  /** @type {string | undefined} */
  let fatal;

  const browser = await chromium.launch({ headless: !run.headed });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.setDefaultTimeout(run.timeoutMs);
  try {
    await signIn(page, run, credentials);
    await openAssistant(page, run);
    turns = await converse(page, run, target, vault);
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    await page
      .screenshot({ path: join(target, "failure.png"), fullPage: true })
      .catch(() => undefined);
  } finally {
    if (!run.keepOpen) {
      await context.close();
      await browser.close();
    }
  }

  const errors = runErrors({ turns });
  const transcript = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: run.baseUrl,
    screen: run.screen,
    account: credentials.email,
    directory: target,
    secretsFile: writeSecrets(target, vault),
    secretCount: vault.entries.length,
    ...(fatal === undefined ? {} : { fatal }),
    errors,
    turns,
  };
  const transcriptFile = join(target, "transcript.json");
  writeFileSync(transcriptFile, `${JSON.stringify(transcript, null, 2)}\n`);

  stdout.write(`agent-converse: ${String(turns.length)} turn(s) on ${run.screen}\n`);
  stdout.write(`agent-converse: transcript ${transcriptFile}\n`);
  if (transcript.secretsFile !== null) {
    stdout.write(
      `agent-converse: ${String(vault.entries.length)} one-time value(s) kept out of the ` +
        `transcript, in ${transcript.secretsFile} (owner-only)\n`,
    );
  }
  for (const error of errors) {
    stderr.write(`agent-converse: turn ${String(error.turn)}, ${error.where}: ${error.text}\n`);
  }
  if (fatal !== undefined) stderr.write(`agent-converse: ${fatal}\n`);
  return errors.length > 0 || fatal !== undefined ? 1 : 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    exit(await main(argv.slice(2), env, cwd()));
  } catch (error) {
    stderr.write(`agent-converse: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(2);
  }
}
