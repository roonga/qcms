// @ts-check
/**
 * Reads back what a scripted assistant run actually left behind, so a scenario is judged on
 * the forms, versions, links and rules the API reports rather than on what the reply claimed.
 * `buildSnapshot` is pure and covered by `end-state.test.ts`; the fetch half needs a stack.
 */

import { writeFileSync } from "node:fs";
import { argv, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:7010";

/** The private BFF-to-API contract. No browser sends either of these. */
export const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";
export const ADMIN_SESSION_HEADER = "x-qcms-admin-session";
export const ENVIRONMENT_HEADER = "x-qcms-environment";

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function localized(value, fallback) {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return fallback;
  const map = /** @type {Record<string, unknown>} */ (value);
  const english = map["en"];
  if (typeof english === "string") return english;
  const first = Object.values(map).find((entry) => typeof entry === "string");
  return typeof first === "string" ? first : fallback;
}

/**
 * The draft definition carries the structure; there is no endpoint that counts it.
 *
 * @param {unknown} draft
 * @returns {{ title: string; questionCount: number; ruleCount: number }}
 */
export function readDraft(draft) {
  if (draft === null || typeof draft !== "object") {
    return { title: "", questionCount: 0, ruleCount: 0 };
  }
  const definition = /** @type {Record<string, unknown>} */ (draft);
  const steps = Array.isArray(definition["steps"]) ? definition["steps"] : [];
  const rules = Array.isArray(definition["rules"]) ? definition["rules"] : [];
  const questionCount = steps.reduce((total, entry) => {
    const items = /** @type {Record<string, unknown>} */ (entry)["items"];
    return total + (Array.isArray(items) ? items.length : 0);
  }, 0);

  return {
    title: localized(definition["title"], ""),
    questionCount,
    ruleCount: rules.length,
  };
}

/**
 * @param {{ detail: Record<string, unknown>; links?: Record<string, unknown>;
 *   releases?: Record<string, unknown> }} payloads
 * @returns {Record<string, unknown>}
 */
export function formSnapshot({ detail, links, releases }) {
  const draft = readDraft(detail["draft"]);
  const versions = Array.isArray(detail["versions"]) ? detail["versions"] : [];
  const releaseList = Array.isArray(releases?.["releases"]) ? releases["releases"] : [];
  const linkList = Array.isArray(links?.["links"]) ? links["links"] : [];

  return {
    formId: detail["formId"] ?? null,
    title: draft.title,
    questionCount: draft.questionCount,
    ruleCount: draft.ruleCount,
    versionCount: versions.length,
    releases: releaseList.map((entry) => {
      const release = /** @type {Record<string, unknown>} */ (entry);
      return { environment: release["environment"], version: release["version"] };
    }),
    // A revoked or expired link is not one the person can open, so it is not one this counts.
    links: linkList
      .filter((entry) => /** @type {Record<string, unknown>} */ (entry)["state"] === "active")
      .map((entry) => {
        const link = /** @type {Record<string, unknown>} */ (entry);
        return { environment: link["environment"], state: link["state"] };
      }),
  };
}

/**
 * @param {readonly { detail: Record<string, unknown>; links?: Record<string, unknown>;
 *   releases?: Record<string, unknown> }[]} forms
 * @returns {{ forms: Record<string, unknown>[] }}
 */
export function buildSnapshot(forms) {
  return { forms: forms.map((payloads) => formSnapshot(payloads)) };
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {{ baseUrl: string; internalToken: string; session: string }}
 */
export function resolveAccess(environment) {
  const internalToken = environment["QCMS_INTERNAL_TOKEN"];
  const session = environment["QCMS_AGENT_REVIEW_SESSION"];
  if (
    internalToken === undefined ||
    internalToken === "" ||
    session === undefined ||
    session === ""
  ) {
    throw new Error(
      "set QCMS_INTERNAL_TOKEN to the stack's channel token and QCMS_AGENT_REVIEW_SESSION to an " +
        "admin session token; both are headers the API requires and neither belongs in a flag",
    );
  }
  const baseUrl = environment["QCMS_API_BASE_URL"] ?? DEFAULT_API_BASE_URL;
  return { baseUrl: baseUrl.replace(/\/+$/u, ""), internalToken, session };
}

/**
 * @param {{ baseUrl: string; internalToken: string; session: string }} access
 * @param {string} path
 * @param {string} environment
 * @returns {Promise<Record<string, unknown>>}
 */
async function read(access, path, environment) {
  const response = await fetch(`${access.baseUrl}/admin${path}`, {
    headers: {
      [INTERNAL_TOKEN_HEADER]: access.internalToken,
      [ADMIN_SESSION_HEADER]: access.session,
      [ENVIRONMENT_HEADER]: environment,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`GET /admin${path} answered ${String(response.status)}`);
  }
  return /** @type {Record<string, unknown>} */ (await response.json());
}

/**
 * @param {{ baseUrl: string; internalToken: string; session: string }} access
 * @param {string} environment
 * @returns {Promise<{ forms: Record<string, unknown>[] }>}
 */
export async function readSnapshot(access, environment) {
  const listed = await read(access, "/forms", environment);
  const forms = Array.isArray(listed["forms"]) ? listed["forms"] : [];
  /** @type {{ detail: Record<string, unknown>; links: Record<string, unknown>;
   *   releases: Record<string, unknown> }[]} */
  const payloads = [];

  for (const entry of forms) {
    const id = String(/** @type {Record<string, unknown>} */ (entry)["formId"]);
    payloads.push({
      detail: await read(access, `/forms/${id}`, environment),
      links: await read(access, `/forms/${id}/links`, environment),
      releases: await read(access, `/forms/${id}/releases`, environment),
    });
  }
  return buildSnapshot(payloads);
}

/**
 * @param {readonly string[]} args
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {Promise<number>}
 */
export async function main(args, environment) {
  const out = args[args.indexOf("--out") + 1];
  const named = args.indexOf("--environment");
  const target = named === -1 ? "test" : (args[named + 1] ?? "test");

  const snapshot = await readSnapshot(resolveAccess(environment), target);
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (out === undefined || args.indexOf("--out") === -1) stdout.write(text);
  else {
    writeFileSync(out, text);
    stdout.write(`agent-review: end state of ${target} in ${out}\n`);
  }
  return 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    exit(await main(argv.slice(2), env));
  } catch (error) {
    stderr.write(`agent-review: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(2);
  }
}
