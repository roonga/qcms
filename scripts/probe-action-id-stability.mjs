#!/usr/bin/env node
// @ts-check
/**
 * Measures whether pinning `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` keeps a no-JS
 * respondent's held repeating step working across a portal deploy (ADR-43).
 *
 * Deliberately not part of `pnpm verify`: the key is cached under
 * `<distDir>/cache/.rscinfo` and reused by later builds in the same tree, so only a
 * from-scratch build shows the real behaviour. Run it after a Next upgrade, since a
 * bump that changes how ids are salted would otherwise surface on a respondent.
 *
 * It deletes and rewrites `apps/portal/.next` three times and needs a port seat
 * (`docs/PORTS.md`), so it cannot run beside a local stack at the same seat.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

import { REPOSITORY_ROOT, runProcess } from "./docker.mjs";
import { assertPortSeatChosen, PORT_SEAT, stablePort } from "./ports.mjs";

const ACTION = {
  filename: "apps/portal/app/s/[sessionId]/roster-action.ts",
  exportedName: "rosterOperation",
};

const DIST = join(REPOSITORY_ROOT, "apps/portal/.next");
const MANIFEST = join(DIST, "server/server-reference-manifest.json");
const STANDALONE = join(DIST, "standalone");
/** Tracing leaves these behind deliberately; the image copies them in, so this does too. */
const STATIC_SOURCE = join(DIST, "static");
const STATIC_TARGET = "apps/portal/.next/static";

/**
 * Must be the page that DECLARES the action: an id is resolved against the posted
 * page's own action manifest, so a valid id posted anywhere else is "not found" too.
 * No real session is needed, since only the status and refusal header are read.
 */
const PROBE_PATH = "/s/ses_probe_action_id_stability";

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;

/** @param {string} line */
function say(line) {
  stdout.write(`${line}\n`);
}

/**
 * Runs `next build` directly rather than through `pnpm build`: turbo declares
 * `.next/**` as the portal build's output, so a cache hit would restore a previous
 * build's `.rscinfo` and this script would compare a build against a copy of itself.
 *
 * @param {string} label
 * @param {string | undefined} key
 * @returns {{ ids: Record<string, string>, actionId: string, encryptionKey: string, tree: string }}
 */
function cleanBuild(label, key) {
  say(`[${label}] removing apps/portal/.next and building`);
  rmSync(DIST, { recursive: true, force: true });
  const buildEnv = { ...env };
  // Deleted rather than left alone, so a value in the caller's environment cannot
  // silently pin the round that is meant to be unpinned.
  delete buildEnv.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  if (key !== undefined) buildEnv.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = key;
  runProcess("pnpm", ["--filter", "qcms-portal", "exec", "next", "build"], buildEnv);

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  /** @type {Record<string, string>} */
  const ids = {};
  let actionId = "";
  for (const [id, entry] of Object.entries({ ...manifest.node, ...manifest.edge })) {
    const reference = /** @type {{ filename?: string, exportedName?: string }} */ (entry);
    const name = `${reference.filename ?? "?"}#${reference.exportedName ?? "?"}`;
    ids[name] = id;
    if (reference.filename === ACTION.filename && reference.exportedName === ACTION.exportedName) {
      actionId = id;
    }
  }
  if (actionId === "") {
    throw new Error(
      `${label}: no Server Action id for ${ACTION.filename}#${ACTION.exportedName}. Either the ` +
        `roster action moved, in which case update ACTION in this script, or the no-JS roster ` +
        `operation is no longer a Server Action, in which case ADR-43 moved and so should this.`,
    );
  }

  const tree = mkdtempSync(join(tmpdir(), "qcms-action-id-"));
  cpSync(STANDALONE, tree, { recursive: true });
  cpSync(STATIC_SOURCE, join(tree, STATIC_TARGET), { recursive: true });
  say(`[${label}] ${ACTION.exportedName} id ${actionId}`);
  return { ids, actionId, encryptionKey: manifest.encryptionKey ?? "", tree };
}

/**
 * @template T
 * @param {string} label
 * @param {string} tree
 * @param {(origin: string) => Promise<T>} probe
 * @returns {Promise<T>}
 */
async function serving(label, tree, probe) {
  const port = stablePort("portal");
  const origin = `http://127.0.0.1:${String(port)}`;
  say(`[${label}] serving ${tree} on ${origin}`);
  const child = spawn("node", ["apps/portal/server.js"], {
    cwd: tree,
    env: {
      ...env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      // Required for boot only: nothing here calls the API, so the base URL just has
      // to be a loopback origin the cookie-security refusal accepts.
      QCMS_API_BASE_URL: `http://127.0.0.1:${String(stablePort("api"))}`,
      QCMS_PORTAL_BASE_URL: origin,
      // Generated per run and never written down: a literal would put a
      // credential-shaped string in the tree for no benefit (SEC-8).
      QCMS_INTERNAL_TOKEN: Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString(
        "base64url",
      ),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => (log += String(chunk)));
  child.stderr.on("data", (chunk) => (log += String(chunk)));

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (child.exitCode !== null) {
        throw new Error(`${label}: the standalone server exited before answering.\n${log}`);
      }
      try {
        await fetch(`${origin}${PROBE_PATH}`);
        break;
      } catch {
        if (Date.now() > deadline) {
          throw new Error(`${label}: the standalone server never answered.\n${log}`);
        }
        await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
      }
    }
    return await probe(origin);
  } finally {
    child.kill("SIGKILL");
  }
}

/**
 * Multipart and nothing else: Next renders the page for a url-encoded POST that is not
 * a fetch action, so a url-encoded probe would pass both rounds and measure nothing.
 *
 * @param {string} origin
 * @param {string} actionId
 * @returns {Promise<{ status: number, refused: boolean, body: string }>}
 */
async function replay(origin, actionId) {
  const form = new FormData();
  form.set("$ACTION_REF_1", "");
  form.set("$ACTION_1:0", JSON.stringify({ id: actionId, bound: "$@1" }));
  form.set("$ACTION_1:1", "[{}]");
  const response = await fetch(`${origin}${PROBE_PATH}`, {
    method: "POST",
    headers: { origin, "sec-fetch-site": "same-origin" },
    body: form,
    redirect: "manual",
  });
  const body = await response.text();
  return {
    status: response.status,
    refused: response.headers.get("x-nextjs-action-not-found") === "1",
    body,
  };
}

/** @type {string[]} */
const failures = [];

/**
 * @param {boolean} condition
 * @param {string} what
 */
function check(condition, what) {
  say(`${condition ? "ok  " : "FAIL"} ${what}`);
  if (!condition) failures.push(what);
}

async function main() {
  assertPortSeatChosen(REPOSITORY_ROOT, "node scripts/probe-action-id-stability.mjs");
  say(`seat ${String(PORT_SEAT)}, portal on ${String(stablePort("portal"))} (docs/PORTS.md)`);
  say("");
  say("This deletes and rewrites apps/portal/.next three times and leaves the last build.");
  say("");

  // Through pnpm rather than turbo: mixing this with the portal's own build in one
  // invocation is how that build would get cached.
  runProcess("pnpm", ["--filter", "qcms-portal^...", "build"]);

  // Minted per run and never written anywhere: a literal here would be a committed key.
  const pinned = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

  /** @type {string[]} */
  const trees = [];
  try {
    const first = cleanBuild("pinned 1", pinned);
    trees.push(first.tree);
    const second = cleanBuild("pinned 2", pinned);
    trees.push(second.tree);
    const third = cleanBuild("unpinned", undefined);
    trees.push(third.tree);

    say("");
    check(
      first.actionId === second.actionId,
      "two clean builds with the same pinned key give the roster action the same id",
    );
    check(
      first.encryptionKey === pinned && second.encryptionKey === pinned,
      "the pinned key is the one the build used, and it is in the build's own manifest",
    );
    check(
      JSON.stringify(first.ids) === JSON.stringify(second.ids),
      "and the same is true of every other Server Action in the app",
    );
    check(
      first.actionId !== third.actionId,
      "a clean build with no pinned key gives the roster action a different id",
    );

    const kept = await serving("pinned 2", second.tree, (origin) => replay(origin, first.actionId));
    check(
      !kept.refused,
      "build 1's id is not refused by build 2, so a held page's Add still runs " +
        `(status ${String(kept.status)}, x-nextjs-action-not-found ${
          kept.refused ? "present" : "absent"
        })`,
    );

    const lost = await serving("unpinned", third.tree, (origin) => replay(origin, first.actionId));
    check(
      lost.status === 409 && lost.refused && lost.body.trim() === "Server Action unavailable.",
      "build 1's id IS refused by the unpinned build, with 409 and " +
        `x-nextjs-action-not-found (status ${String(lost.status)}, body ${JSON.stringify(
          lost.body.trim().slice(0, 60),
        )})`,
    );
  } finally {
    for (const tree of trees) rmSync(tree, { recursive: true, force: true });
  }

  say("");
  if (failures.length > 0) {
    stderr.write(
      `${String(failures.length)} check(s) failed. Next's Server Action salt no longer behaves ` +
        "the way ADR-43's amendment of 2026-10-10 and docs/deploy-ingress.md describe. Re-measure " +
        "before changing either, and read the amendment first: the fourteen-day .rscinfo cache " +
        "makes an incremental rebuild report a false green.\n",
    );
    exit(1);
  }
  say("Pinning NEXT_SERVER_ACTIONS_ENCRYPTION_KEY keeps the roster action's id across builds,");
  say("and leaving it unset does not. docs/deploy-ingress.md is the operator's version.");
}

// `pathToFileURL` rather than a `file://` template: `import.meta.url` is
// percent-encoded, so a path holding a space would make the comparison silently false.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  await main();
}
