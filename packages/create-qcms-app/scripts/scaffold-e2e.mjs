#!/usr/bin/env node
// @ts-check
/**
 * Adopter flow from packed tarballs, then the scenario-1 loop over HTTP. Admin 2FA is `optional`.
 * Usage: QCMS_PORT_SEAT=<0-9> node packages/create-qcms-app/scripts/scaffold-e2e.mjs [--keep]
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

/** Mirrors `PUBLISHED_PACKAGES` in `sync-templates.mjs`; `assertPacksEveryStampedPackage` fails on drift. */
const PACKED = ["core", "a2ui-compiler", "db", "ui", "observability", "csv"];

/** Where the harness puts the tarballs inside the scaffold, relative to its root. */
const VENDOR_DIRECTORY = "apps/.qcms-tarballs";

const PORTS = {
  portal: harnessPort("portal"),
  admin: harnessPort("admin"),
  api: harnessPort("api"),
};

/** Throwaway per run, from the CSPRNG: `create-admin` checks it against the breach corpus (SEC-1). */
const ADMIN = {
  email: "scaffold-e2e@qcms.invalid",
  password: `Sc4ffold-e2e-${Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`,
};

/**
 * Throws rather than exiting so the `finally` that tears the stack down still runs.
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

/** Absolute by construction, so no subprocess is resolved through `PATH`. */
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

/** A pin belongs here only while an issue is open against the underlying break. */
const PINNED_DEPENDENCIES = {
  // TODO(#448): apps/api does not typecheck against 1.5.2; remove when it closes.
  "@hono/zod-openapi": "1.5.1",
};

/** The `overrides:` block that redirects the packed packages at the vendored tarballs. */
function overridesBlock(tarballNames) {
  const lines = [
    "",
    "# Added by scaffold-e2e.mjs, never by create-qcms-app. The @roonga/qcms-* packages are",
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

/** A shell variable outranks `--env-file`, so the seat's ports land without editing the CLI's `.env` (R8). */
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

/** Reads the generated templates, not the generator's constant, so it checks what an adopter receives. */
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
        if (name.startsWith("@roonga/qcms-")) stamped.add(name.slice("@roonga/qcms-".length));
      }
    }
  }
  const missing = [...stamped].filter((name) => !PACKED.includes(name)).sort();
  if (missing.length > 0) {
    throw new Error(
      `scaffold-e2e: the scaffolded manifests depend on @roonga/qcms-${missing.join(", @roonga/qcms-")}, which ` +
        `PACKED in this file does not pack. This run would install them from a registry that has ` +
        `never published them.`,
    );
  }
}

/** Stamp the scaffold from the CLI's own tarball, and install it from the others. */
function buildScaffold(workspace) {
  const tarballs = join(workspace, "tarballs");
  mkdirSync(tarballs, { recursive: true });

  // Through turbo: pnpm's recursive order only sequences declared dependencies, and portal's
  // build needs db's `dist/` intact.
  pnpm(["build"], REPOSITORY_ROOT);

  assertPacksEveryStampedPackage();

  /** @type {Record<string, string>} */
  const names = {};
  for (const name of PACKED) {
    names[`@roonga/qcms-${name}`] = pack(`packages/${name}`, tarballs).split("/").pop() ?? "";
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

  pnpm(["install"], scaffold);
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
 * Inside the dev container the stack's published ports are on another host, so join its
 * network and use Compose service names; `fetch` enforces no cookie policy, unlike the
 * browser harness in `scripts/compose-e2e.mjs`.
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
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- container-to-container on an ephemeral network; TLS ends at the ingress (ADR-20)
      api: "http://api:3000",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- container-to-container on an ephemeral network; TLS ends at the ingress (ADR-20)
      portal: "http://portal:3000",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- container-to-container on an ephemeral network; TLS ends at the ingress (ADR-20)
      admin: "http://admin:3000",
    },
    network,
  };
}

/** Leave the stack's network, tolerating an already-gone attachment. */
function leaveNetwork(network) {
  if (network === undefined) return;
  const self = readFileSync("/etc/hostname", "utf8").trim();
  // Before `docker compose down`, which cannot remove a network this container is attached to.
  spawnSync(DOCKER, ["network", "disconnect", network, self], { stdio: "ignore" });
}

function runSmoke(scaffold, endpoints) {
  pnpm(["exec", "vitest", "run", "--project", "create-qcms-app-e2e"], REPOSITORY_ROOT, {
    QCMS_SCAFFOLD_API_URL: endpoints.urls["api"] ?? "",
    QCMS_SCAFFOLD_PORTAL_URL: endpoints.urls["portal"] ?? "",
    QCMS_SCAFFOLD_ADMIN_URL: endpoints.urls["admin"] ?? "",
    QCMS_SCAFFOLD_PORTAL_BASE_URL: `http://localhost:${String(PORTS.portal)}`,
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
