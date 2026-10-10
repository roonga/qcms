#!/usr/bin/env node
// @ts-check
/**
 * Does a no-JS respondent's held repeating step survive a portal deploy?
 *
 * ## What this measures, and why it is a script and not a gate
 *
 * The no-JS Add and Remove of a repeating group is a Next Server Action (ADR-43), and
 * Next hashes every Server Action id with an encryption key it generates **per build**.
 * So a build can rename the id the previous build's pages are holding, and a respondent
 * who posts the old one gets Next's `409 Server Action unavailable.` with no page of the
 * portal rendering (issue #1035, the #504 entry in `docs/operations.md`).
 *
 * Whether that happens is a deployment choice. `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` pins
 * the key, which pins the ids, which keeps the held page working. This script is the
 * measurement behind that claim: three clean production builds and two replayed posts.
 *
 * It is not part of `pnpm verify`, and the reason is the word **clean**. The key is
 * cached under `<distDir>/cache/.rscinfo` for fourteen days and reused by later builds in
 * the same tree, so an incremental rebuild keeps its ids and reports a false green. Only
 * a from-scratch build shows the real behaviour, which is also why a container, which is
 * never the same tree, is where this bites and a developer's machine never is. Three
 * from-scratch production builds are minutes, not seconds, and they would also fight
 * Turborepo's cache for `apps/portal/.next`.
 *
 * **Run it after a Next upgrade.** This behaviour has already moved once: at 16.4.0 the
 * refusal changed from a bare `500` to the `409` plus header that the records now carry
 * (ADR-43's amendments of 2026-10-10). A bump that changes how ids are salted, or that
 * stops honouring the env key, would otherwise be invisible until a respondent found it.
 *
 * ## What it asserts
 *
 *   1. two clean builds with the same pinned key give `rosterOperation` the SAME id;
 *   2. a clean build with no pinned key gives it a DIFFERENT one;
 *   3. replaying build 1's id against build 2 is NOT refused as an unknown action;
 *   4. replaying build 1's id against build 3 IS, with `409`, `text/plain`,
 *      `Server Action unavailable.` and `x-nextjs-action-not-found: 1`.
 *
 * Together those are "pinning the key is what makes a held page survive a deploy", with
 * (4) as the control that the unpinned case really does break.
 *
 * ## Usage
 *
 *   QCMS_PORT_SEAT=<0-9> node scripts/probe-action-id-stability.mjs
 *
 * It needs the seat for the same reason every other port-binding entry point does
 * (`docs/PORTS.md`): it serves each build on the seat's stable portal port, so it cannot
 * run beside `pnpm dev:portal` or a local stack at the same seat.
 *
 * **It deletes and rewrites `apps/portal/.next`**, three times, and leaves the last
 * build (the unpinned one) behind. Nothing else in the tree is touched. The two standalone
 * trees it serves are copies under the system temp directory and are removed on every
 * exit path.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";

import { REPOSITORY_ROOT, runProcess } from "./docker.mjs";
import { assertPortSeatChosen, PORT_SEAT, stablePort } from "./ports.mjs";

/** The action whose id decides whether a held repeating step survives. */
const ACTION = {
  filename: "apps/portal/app/s/[sessionId]/roster-action.ts",
  exportedName: "rosterOperation",
};

/** Where `next build` writes the production build, and what gets deleted each round. */
const DIST = join(REPOSITORY_ROOT, "apps/portal/.next");
/** The manifest carrying every action id and the key they were hashed with. */
const MANIFEST = join(DIST, "server/server-reference-manifest.json");
/** Next's own deployment output, which is what `docker/portal.Dockerfile` ships. */
const STANDALONE = join(DIST, "standalone");
/** Tracing leaves these behind deliberately; the image copies them in, so this does too. */
const STATIC_SOURCE = join(DIST, "static");
const STATIC_TARGET = "apps/portal/.next/static";

/**
 * A page that exists, needs no session and reaches no API.
 *
 * The id check happens before any of the app runs, so the unpinned round never renders
 * anything; the pinned round does render this page, which is why it has to be one that
 * can render on its own.
 */
const PROBE_PATH = "/expired";

/** How long to wait for a standalone server to answer before giving up. */
const READY_TIMEOUT_MS = 30_000;
/** How often to ask. */
const READY_POLL_MS = 250;

/** @param {string} line */
function say(line) {
  stdout.write(`${line}\n`);
}

/**
 * One clean production build of the portal, and what it produced.
 *
 * The build runs `next build` DIRECTLY rather than through `pnpm build`, and that is the
 * load-bearing detail: `turbo.json` declares `.next/**` as the portal build's output, so
 * a cache hit would restore a previous build's `.next` - including its `.rscinfo` - and
 * this script would compare a build against a copy of itself.
 *
 * @param {string} label
 * @param {string | undefined} key the pinned salt, or undefined to let Next generate one.
 * @returns {{ ids: Record<string, string>, actionId: string, encryptionKey: string, tree: string }}
 */
function cleanBuild(label, key) {
  say(`[${label}] removing apps/portal/.next and building`);
  rmSync(DIST, { recursive: true, force: true });
  const buildEnv = { ...env };
  // Deleted rather than merely left alone, so a value in the caller's own environment
  // cannot silently pin the round that is meant to be unpinned and turn this whole
  // script into two measurements of the same thing.
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
 * Serve one standalone tree on the seat's portal port, run `probe`, then stop it.
 *
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
      // The portal refuses to boot without these. Nothing this probe touches calls the
      // API, so the base URL only has to be a loopback origin the cookie-security
      // refusal accepts (issue #292).
      QCMS_API_BASE_URL: `http://127.0.0.1:${String(stablePort("api"))}`,
      QCMS_PORTAL_BASE_URL: origin,
      // Generated, never written down, and used for nothing: this probe makes no API
      // call, the variable only has to be present and not one of the shipped
      // placeholder shapes the boot refusal rejects (issue #491, SEC-8). A literal
      // here would be a credential-shaped string in the tree for no benefit.
      QCMS_INTERNAL_TOKEN: Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString(
        "base64url",
      ),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  /** Everything the server said, quoted only if the probe cannot reach it. */
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
 * Replay a no-JS Server Action post carrying `actionId`, as a browser sends it.
 *
 * MULTIPART and nothing else: Next treats a url-encoded POST that is not a fetch action
 * as not an action request at all and simply renders the page, so a url-encoded probe
 * would pass both rounds and measure nothing. The `Origin` and `Sec-Fetch-Site` are what
 * a real navigation POST carries, which is also what SEC-9's belt reads.
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

  // The workspace packages the portal build imports from their dist. Through pnpm rather
  // than turbo, because the portal's own build below must not be cached and mixing the
  // two in one invocation is how it would be.
  runProcess("pnpm", ["--filter", "qcms-portal^...", "build"]);

  // 32 bytes base64, the shape `.env.compose.example` tells an operator to generate. It
  // is minted per run and never written anywhere: a literal here would be a committed
  // key, and the measurement only needs the two pinned rounds to agree with each other.
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
      `build 1's id is not refused by build 2 (status ${String(kept.status)}, no ` +
        "x-nextjs-action-not-found), so a held page's Add still runs",
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

if (import.meta.url === `file://${argv[1]}`) {
  await main();
}
