#!/usr/bin/env node
// @ts-check
/**
 * The adopter experience, end to end, from packed tarballs (task 037 exit criteria 1
 * and 3).
 *
 * ## What this proves that nothing else can
 *
 * Every other gate in this repository runs inside the workspace, where pnpm hoists
 * `@qcms/*` from `packages/` and every import resolves whether or not it was
 * declared. An adopter has none of that. This harness removes it: every published
 * package is packed with `pnpm pack` and installed as a tarball, the CLI is run from
 * ITS tarball (so a template file missing from `files` fails here rather than in
 * someone's first five minutes), and the images are built from the scaffolded tree
 * with the scaffolded Dockerfiles.
 *
 * Then it runs the commands the scaffolded README prints, in order, and drives the
 * 027 scenario-1 loop over HTTP against the result: sign in, author a question,
 * publish it, author a form, publish it, mint a secure link, redeem it as a
 * respondent through the portal, answer, submit, and read the response back through
 * the admin API.
 *
 * ## Three deliberate deviations from what an adopter does
 *
 * Each is a property of this repository's pre-publish state, not of the scaffold:
 *
 *   1. **`@qcms/*` resolve from tarballs**, because they are not published yet. The
 *      tarballs are copied to `apps/.qcms-tarballs/` inside the scaffold and the
 *      overrides are RELATIVE, so the same specifiers resolve identically on the host
 *      and inside the image (`docker/*.Dockerfile` copies `apps/`). Nothing in the
 *      shipped Dockerfiles is edited to make this work, which is the point: a change
 *      to them would mean the images this proves are not the images that ship.
 *   2. **The CLI is run with `--no-install`** and the install happens after the
 *      overrides are written, because they have to exist before resolution.
 *   3. **The API is published on a host port** by an override file this harness
 *      writes. `docker-compose.yml` publishes portal and admin only (ADR-20) and that
 *      is not tradeable, so the override is separate, written here, and never
 *      stamped by the CLI.
 *
 * Admin 2FA is set to `optional` for this run, which the CLI supports as a flag and
 * the schema documents as the development escape hatch. Enrolling TOTP would test
 * better-auth, which `apps/admin`'s own suite already covers; what this harness is
 * for is the scaffold.
 *
 * Usage:
 *   QCMS_PORT_SEAT=<0-9> node packages/create-qcms-app/scripts/scaffold-e2e.mjs
 *   QCMS_PORT_SEAT=<0-9> node packages/create-qcms-app/scripts/scaffold-e2e.mjs --keep
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DOCKER } from "../../../scripts/docker.mjs";
import { isInDockerContainer } from "../../../scripts/docker-host.mjs";
import { assertPortSeatChosen, composeProjectName, harnessPort } from "../../../scripts/ports.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The packages an adopter installs, plus the CLI that stamps their consumers.
 *
 * Mirrors `PUBLISHED_PACKAGES` in `sync-templates.mjs`, and `packsEveryPublishedPackage`
 * below fails if the two drift: a package the generator stamps into the adopter's
 * manifest and this harness does not pack is a package this run would install from a
 * registry that has never seen it.
 */
const PACKED = ["core", "a2ui-compiler", "db", "ui", "observability", "csv"];

/** Where the harness puts the tarballs inside the scaffold, relative to its root. */
const VENDOR_DIRECTORY = "apps/.qcms-tarballs";

const PORTS = {
  portal: harnessPort("portal"),
  admin: harnessPort("admin"),
  api: harnessPort("api"),
};

/**
 * The one administrator this run creates. Throwaway, per run, never reused, and
 * never written to a file: it lives in this process and in the environment of the
 * two children that need it.
 *
 * From the platform CSPRNG rather than `Math.random`, because it is a real password
 * on a real account for as long as the stack is up, and `create-admin` checks it
 * against the breach corpus (SEC-1) before accepting it.
 */
const ADMIN = {
  email: "scaffold-e2e@qcms.invalid",
  password: `Sc4ffold-e2e-${Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`,
};

/**
 * Run a child process to completion in `cwd`, throwing on a non-zero exit.
 *
 * `scripts/docker.mjs`'s `runProcess` pins its cwd to the repository root, and every
 * step here runs inside a temporary scaffold instead, so this harness keeps its own
 * one-screen version rather than widening a shared helper for one caller.
 *
 * Throwing (never `process.exit`) is load-bearing: `exit` does not unwind, so it
 * would skip the `finally` that tears the stack down, and a failed run would leave
 * containers and a named volume behind.
 *
 * @param {string} command an ABSOLUTE path, never a name resolved through PATH
 * @param {readonly string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [environment]
 */
function run(command, args, cwd, environment = env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${String(result.status)}`);
  }
}

/**
 * Run pnpm through this same Node binary and the pnpm entry point that launched us.
 *
 * Absolute by construction, so no subprocess here is resolved through `PATH`
 * (`sonarjs/no-os-command-from-path`, issue #119).
 */
function pnpm(args, cwd, extraEnvironment = {}) {
  const entrypoint = env["npm_execpath"];
  if (entrypoint === undefined || entrypoint === "") {
    throw new Error(
      "npm_execpath is unset, so pnpm cannot be located without a PATH lookup. Run this through `pnpm`.",
    );
  }
  run(process.execPath, [entrypoint, ...args], cwd, { ...env, ...extraEnvironment });
}

/** `pnpm pack` one workspace package into `destination`, returning the tarball path. */
function pack(packageDirectory, destination) {
  const before = new Set(readdirSync(destination));
  pnpm(["pack", "--pack-destination", destination], join(REPOSITORY_ROOT, packageDirectory));
  const created = readdirSync(destination).filter((name) => !before.has(name));
  if (created.length !== 1) {
    throw new Error(
      `pnpm pack in ${packageDirectory} produced ${String(created.length)} new files; expected exactly one tarball.`,
    );
  }
  return join(destination, created[0] ?? "");
}

/** Unpack a tarball into `destination`, returning the `package/` directory inside it. */
function unpack(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync("/bin/tar", ["-xzf", tarball, "-C", destination], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Could not unpack ${tarball}.`);
  return join(destination, "package");
}

/**
 * Third-party versions this harness pins, with the reason each one is pinned.
 *
 * A scaffolded project ships no lockfile, so `pnpm install` resolves every range to
 * the current latest. That is the adopter's real experience and this harness runs it
 * deliberately, but it also means an upstream release can turn this run red for a
 * reason that has nothing to do with the scaffold. A pin belongs here only while an
 * issue is open against the underlying break, and it carries that issue number.
 */
const PINNED_DEPENDENCIES = {
  // Issue #448: apps/api does not typecheck against 1.5.2, which its own `^1.5.1`
  // range admits. The repository's lockfile hides it; a scaffold has no lockfile, so
  // this harness would fail inside the image build on a bug that is not the
  // scaffold's. Remove this entry when #448 closes.
  "@hono/zod-openapi": "1.5.1",
};

/** The `overrides:` block that redirects the packed packages at the vendored tarballs. */
function overridesBlock(tarballNames) {
  const lines = [
    "",
    "# Added by scaffold-e2e.mjs, never by create-qcms-app. The @qcms/* packages are",
    "# not published yet, so this run resolves them from tarballs `pnpm pack` produced.",
    "# The paths are relative so they mean the same thing on the host and inside the",
    "# image, where the build context has copied apps/ (and this directory with it).",
    "overrides:",
  ];
  for (const [name, file] of Object.entries(tarballNames)) {
    lines.push(`  "${name}": "file:./${VENDOR_DIRECTORY}/${file}"`);
  }
  for (const [name, version] of Object.entries(PINNED_DEPENDENCIES)) {
    lines.push(`  "${name}": "${version}"`);
  }
  return `${lines.join("\n")}\n`;
}

/** The Compose override that publishes the API, for this harness only. */
function apiPublishOverride() {
  return [
    "# Written by scaffold-e2e.mjs. `docker-compose.yml` publishes portal and admin",
    "# only, and that is a property of the topology (ADR-20), not an oversight: the",
    "# API container is never published in a deployment. This override exists because",
    "# the smoke suite drives the admin API directly, and it is deliberately a",
    "# separate file that the CLI never stamps.",
    "services:",
    "  api:",
    "    ports:",
    `      - "127.0.0.1:${String(PORTS.api)}:3000"`,
    "",
  ].join("\n");
}

/**
 * The environment Compose runs under: this seat's harness ports, over the scaffold's
 * own `.env`.
 *
 * The scaffolded `.env` leaves the two port variables commented out, because they
 * are optional and their defaults are seat 0's stable ports - which is right for an
 * adopter and wrong for a test harness sharing a machine with a dev container. A
 * shell variable outranks `--env-file` in Compose, so this is where the seat lands
 * without editing the file the CLI wrote (R8, docs/PORTS.md).
 */
function composeEnvironment() {
  return {
    ...env,
    QCMS_PORTAL_PORT: String(PORTS.portal),
    QCMS_ADMIN_PORT: String(PORTS.admin),
  };
}

function composeArgs(scaffold, project) {
  return [
    "compose",
    "--project-name",
    project,
    "--project-directory",
    scaffold,
    "--env-file",
    join(scaffold, ".env"),
    "--file",
    join(scaffold, "docker-compose.yml"),
    "--file",
    join(scaffold, "docker-compose.smoke.yml"),
  ];
}

/**
 * Fail unless every `@qcms/*` the generator stamps into an app manifest is packed here.
 *
 * Two hand-maintained lists of the same set, in two files, and the direction that goes
 * wrong quietly is this one: a package the generator stamps and this harness does not
 * pack is installed from a registry that has never heard of it, so the run dies inside
 * `pnpm install` with a resolution error rather than saying which list is short. Read
 * out of the generated templates rather than out of the generator's own constant, so
 * it checks what an adopter receives.
 */
function assertPacksEveryStampedPackage() {
  /** @type {Set<string>} */
  const stamped = new Set();
  for (const app of ["api", "portal", "admin"]) {
    const manifest = JSON.parse(
      readFileSync(
        join(
          REPOSITORY_ROOT,
          "packages/create-qcms-app/templates/common/apps",
          app,
          "package.json",
        ),
        "utf8",
      ),
    );
    for (const block of [manifest.dependencies, manifest.devDependencies]) {
      for (const name of Object.keys(block ?? {})) {
        if (name.startsWith("@qcms/")) stamped.add(name.slice("@qcms/".length));
      }
    }
  }
  const missing = [...stamped].filter((name) => !PACKED.includes(name)).sort();
  if (missing.length > 0) {
    throw new Error(
      `scaffold-e2e: the scaffolded manifests depend on @qcms/${missing.join(", @qcms/")}, which ` +
        `PACKED in this file does not pack. This run would install them from a registry that has ` +
        `never published them.`,
    );
  }
}

/** Stamp the scaffold from the CLI's own tarball, and install it from the others. */
function buildScaffold(workspace) {
  const tarballs = join(workspace, "tarballs");
  mkdirSync(tarballs, { recursive: true });

  // `pnpm pack` packs whatever is in `dist` right now. Building first is what stops
  // this harness from certifying a tarball nobody built.
  pnpm(["-r", "build"], REPOSITORY_ROOT);

  assertPacksEveryStampedPackage();

  /** @type {Record<string, string>} */
  const names = {};
  for (const name of PACKED) {
    names[`@qcms/${name}`] = pack(`packages/${name}`, tarballs).split("/").pop() ?? "";
  }
  const cliTarball = pack("packages/create-qcms-app", tarballs);
  const cli = unpack(cliTarball, join(workspace, "cli"));

  const scaffold = join(workspace, "my-forms");
  run(
    process.execPath,
    [
      join(cli, "dist", "cli.js"),
      scaffold,
      "--yes",
      "--no-install",
      "--no-git",
      "--admin-2fa",
      "optional",
      "--portal-base-url",
      `http://localhost:${String(PORTS.portal)}`,
      "--admin-base-url",
      `http://localhost:${String(PORTS.admin)}`,
    ],
    workspace,
  );

  const vendor = join(scaffold, ...VENDOR_DIRECTORY.split("/"));
  mkdirSync(vendor, { recursive: true });
  for (const file of Object.values(names)) cpSync(join(tarballs, file), join(vendor, file));

  const workspaceFile = join(scaffold, "pnpm-workspace.yaml");
  writeFileSync(workspaceFile, readFileSync(workspaceFile, "utf8") + overridesBlock(names));
  writeFileSync(join(scaffold, "docker-compose.smoke.yml"), apiPublishOverride());

  // The README's own first command. It has to run here rather than inside the CLI
  // because the overrides above must exist before anything resolves.
  pnpm(["install"], scaffold);
  // The stamped shell has to compile against the PACKAGED packages, not against this
  // workspace's sources. This is where a missing `files` entry or an undeclared
  // dependency surfaces.
  pnpm(["-r", "typecheck"], scaffold);
  return scaffold;
}

/** Bring the stack up and create the first administrator, per the README. */
function startStack(scaffold, project) {
  const compose = composeArgs(scaffold, project);
  run(DOCKER, [...compose, "up", "-d", "--build", "--wait"], scaffold, composeEnvironment());
  run(DOCKER, [...compose, "run", "--rm", "migrate"], scaffold, composeEnvironment());
  run(
    DOCKER,
    [
      ...compose,
      "exec",
      "-e",
      `QCMS_ADMIN_EMAIL=${ADMIN.email}`,
      "-e",
      `QCMS_ADMIN_PASSWORD=${ADMIN.password}`,
      "api",
      "node",
      "dist/create-admin.js",
    ],
    scaffold,
    composeEnvironment(),
  );
}

/** The one value the smoke suite needs that only the scaffold knows. */
function internalToken(scaffold) {
  const line = readFileSync(join(scaffold, ".env"), "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith("QCMS_INTERNAL_TOKEN="));
  if (line === undefined) throw new Error("The scaffolded .env carries no QCMS_INTERNAL_TOKEN.");
  return line.slice("QCMS_INTERNAL_TOKEN=".length);
}

/**
 * Where the smoke suite dials the three services, which depends on where it runs.
 *
 * On a plain host and on CI, the published ports are on `localhost` and there is
 * nothing to arrange. Inside the dev container they are not: the stack publishes on
 * the DOCKER HOST's loopback, and that host is another machine from in here
 * (ADR-29's mounted socket, issue #316). `scripts/compose-e2e.mjs` solves the same
 * problem by forwarding, because its client is a browser and the browsed origin has
 * to stay `http://localhost` for `Secure` cookies to work. This client is `fetch`,
 * which enforces no cookie policy at all and is handed every `Set-Cookie` by hand,
 * so the far cheaper answer applies: join the stack's network and use Compose's own
 * service names. That difference is stated rather than assumed, because copying the
 * browser harness's shape here would be 150 lines of forwarding for no gain, and
 * copying THIS shape into the browser harness would silently stop covering the auth
 * boundary it exists for.
 *
 * @param {string} project
 * @returns {{ urls: Record<string, string>; network?: string }}
 */
function smokeEndpoints(project) {
  if (!isInDockerContainer()) {
    return {
      urls: {
        api: `http://localhost:${String(PORTS.api)}`,
        portal: `http://localhost:${String(PORTS.portal)}`,
        admin: `http://localhost:${String(PORTS.admin)}`,
      },
    };
  }
  const self = readFileSync("/etc/hostname", "utf8").trim();
  if (self === "") throw new Error("scaffold-e2e: cannot determine this container's id");
  const network = `${project}_default`;
  run(DOCKER, ["network", "connect", network, self], REPOSITORY_ROOT);
  return {
    urls: {
      // The container port, not the published one: inside the network there is no
      // publish to speak of. It is the same 3000 every image EXPOSEs. Plain http is
      // correct and unavoidable here: this is a container-to-container address on an
      // ephemeral Compose network with no certificate and no ingress, which is
      // exactly the topology ADR-20 describes (TLS terminates at the operator's
      // ingress, never between these containers).
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- see above
      api: "http://api:3000",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- see above
      portal: "http://portal:3000",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- see above
      admin: "http://admin:3000",
    },
    network,
  };
}

/** Leave the stack's network, tolerating an already-gone attachment. */
function leaveNetwork(network) {
  if (network === undefined) return;
  const self = readFileSync("/etc/hostname", "utf8").trim();
  // Deliberately before `docker compose down`: Compose cannot remove a network this
  // container is still attached to, so leaving it late strands the network.
  spawnSync(DOCKER, ["network", "disconnect", network, self], { stdio: "ignore" });
}

function runSmoke(scaffold, endpoints) {
  pnpm(["exec", "vitest", "run", "--project", "create-qcms-app-e2e"], REPOSITORY_ROOT, {
    QCMS_SCAFFOLD_API_URL: endpoints.urls["api"] ?? "",
    QCMS_SCAFFOLD_PORTAL_URL: endpoints.urls["portal"] ?? "",
    QCMS_SCAFFOLD_ADMIN_URL: endpoints.urls["admin"] ?? "",
    // The operator's ANSWER, as opposed to where this run dials: the minted secure
    // link is built from it, so comparing the two proves the answer reached the API.
    QCMS_SCAFFOLD_PORTAL_BASE_URL: `http://localhost:${String(PORTS.portal)}`,
    // better-auth trusts exactly this origin, so the sign-in call has to send it.
    QCMS_SCAFFOLD_ADMIN_BASE_URL: `http://localhost:${String(PORTS.admin)}`,
    QCMS_SCAFFOLD_INTERNAL_TOKEN: internalToken(scaffold),
    QCMS_SCAFFOLD_ADMIN_EMAIL: ADMIN.email,
    QCMS_SCAFFOLD_ADMIN_PASSWORD: ADMIN.password,
  });
}

export function main(args = argv.slice(2)) {
  assertPortSeatChosen(REPOSITORY_ROOT, "pnpm qcms:scaffold-e2e");
  const workspace = mkdtempSync(join(tmpdir(), "qcms-scaffold-e2e-"));
  const project = `${composeProjectName()}-scaffold-e2e`;
  let scaffold;
  let network;
  try {
    scaffold = buildScaffold(workspace);
    startStack(scaffold, project);
    const endpoints = smokeEndpoints(project);
    network = endpoints.network;
    runSmoke(scaffold, endpoints);
    stdout.write("\nscaffold-e2e: the scaffolded stack completed the scenario-1 loop.\n");
    return 0;
  } finally {
    leaveNetwork(network);
    if (scaffold !== undefined) {
      run(
        DOCKER,
        [...composeArgs(scaffold, project), "down", "--volumes", "--remove-orphans"],
        scaffold,
        composeEnvironment(),
      );
    }
    if (args.includes("--keep")) stdout.write(`scaffold-e2e: kept ${workspace}\n`);
    else rmSync(workspace, { recursive: true, force: true });
  }
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    exit(main());
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  }
}
