#!/usr/bin/env node
// @ts-check
/**
 * Port-allocation gate (R8, ADR-37, `docs/PORTS.md`).
 *
 * The boundary: a number counts only where the surrounding syntax says "port", so a
 * clean run means "no port written in one of the recognised shapes", never "no port
 * outside the allocation exists". Known blind spots are a standalone `PORT`
 * identifier, any shape inside `package.json` (broad `.json` is excluded so a gate
 * can never demand an edit to the append-only golden corpus), a bare Compose publish
 * mapping, and a port built by arithmetic or a template literal.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

import {
  HARNESS_SERVICES,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  STABLE_SERVICES,
  harnessPorts,
  stablePort,
} from "./ports.mjs";
import { VENDORED_SOURCE_PATHSPEC } from "./vendored-source.mjs";

const GIT = "git";

const GLOBS = [
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.md",
  "*.yml",
  "*.yaml",
  "*.sh",
  // Both spellings, and the generator's `.tmpl`, so an image definition cannot leave
  // the gate's view by being named differently or by gaining a placeholder.
  "*.Dockerfile",
  "Dockerfile",
  "*.Dockerfile.tmpl",
  ".devcontainer/devcontainer.json",
  "*.env.example",
  ".env.example",
];

/** The vendored half comes from the single definition, never a path typed here. */
const EXCLUDES = [VENDORED_SOURCE_PATHSPEC, ":!plan/**"];

/**
 * `file` is matched with `===`, never as a substring: a suffix test would exempt any
 * path merely containing an entry and wave a real violation through. Every entry must
 * fire, and `check-ports.test.ts` fails if one stops, so a dead exemption cannot
 * linger and read as evidence the gate inspects that file.
 *
 * @type {{ file: string; value: number; why: string }[]}
 */
export const ALLOWED = [
  {
    file: "docs/agent-authoring.md",
    value: 11434,
    why: "Ollama's own default port, in the local-model walkthrough (041). Not a QCMS port: it is the third-party runtime's, and an operator reading the guide needs the number their own install actually listens on.",
  },
  {
    file: "docs/agent-authoring.md",
    value: 1234,
    why: "LM Studio's own default server port, in the Windows and WSL2 walkthrough (issue #819). Third-party like Ollama's above, and named for the same reason: an operator types the number their own install listens on. This one carries a second trap the guide has to show - the port is unreachable from WSL2 or a container until LM Studio is told to serve on the local network - so it appears there in three different addresses.",
  },
  {
    file: "packages/db/src/testing/pool-contention.test.ts",
    value: 34517,
    why: "the ephemeral port Docker mapped to a test container, quoted inside the `connect ECONNREFUSED` message `pg` raises against it (issue #939). Docker picks it, not this repository, and it differs every run; the fixture keeps the whole message, loopback address and trailing port included, because what is under test is whether that exact wording is recognised as a contention shape.",
  },
  {
    file: "apps/api/src/config.test.ts",
    value: 11434,
    why: "Ollama's own default port again, in the fixtures that assert the local-endpoint key relaxation (041). The value under test is the hostname, not the port.",
  },
  {
    file: "apps/api/src/config.test.ts",
    value: 8000,
    why: "vLLM's own default port, in the same local-endpoint fixtures (041). Third-party, never bound by anything in this repo.",
  },
  {
    file: "docs/DEVELOPER_GUIDE.md",
    value: 4318,
    why: "the OTLP/HTTP default, in the optional local trace-viewer recipe a developer runs themselves. Named here precisely so the harness can be documented as avoiding it.",
  },
  {
    file: "docs/DEVELOPER_GUIDE.md",
    value: 16686,
    why: "Jaeger's own UI port, in the third-party viewer recipe.",
  },
  {
    file: "docs/DEVELOPER_GUIDE.md",
    value: 18888,
    why: "the Aspire dashboard's own UI port, in the third-party viewer recipe.",
  },
  {
    file: "apps/portal/e2e/support/portal-server.test.ts",
    value: 99999,
    why: "deliberately invalid: the fixture reproduces the out-of-range `next dev` startup failure from issue #58. Not an allocation, and not bindable by construction.",
  },
  {
    file: "apps/portal/e2e/support/gates.test.ts",
    value: 99999,
    why: "same #58 fixture line, quoted here as gate-pattern test data.",
  },
  {
    file: "apps/api/src/main.ts",
    value: 3000,
    why: "the API server's SHIPPED default for adopters, not a QCMS machine allocation (ADR-20: the container is never published). Every QCMS dev path passes 7S10 explicitly.",
  },
  {
    file: "scripts/loopback-forward.mjs",
    value: 3000,
    why: "the app containers' own listening port, in this module's usage example. A container-internal port is the image's business and never a QCMS allocation (same reason as apps/api/src/main.ts above). The forwarder reads the real value from `docker inspect` at runtime rather than assuming it.",
  },
  {
    file: "scripts/loopback-forward.test.ts",
    value: 3000,
    why: "the same container-internal port, as route-table fixture data for the parser tests. Nothing dials it.",
  },
  {
    file: "docs/deploy/fly.md",
    value: 3000,
    why: "the app containers' own listening port, in the Fly.io fly.toml examples (the `internal_port` value). A container-internal port is the image's business and never a QCMS host allocation (same reason as apps/api/src/main.ts, the shipped default). Fly reaches it on 6PN by that internal port.",
  },
  {
    file: "docker/api.Dockerfile",
    value: 3000,
    why: "the container's OWN listening port, dialled by its HEALTHCHECK from inside the container. A container-internal port is the image's business and never a QCMS host allocation (same reason as apps/api/src/main.ts, the shipped default). ADR-20: the API container is never published.",
  },
  {
    file: "docker/admin.Dockerfile",
    value: 3000,
    why: "same: the Next.js server's own in-container port, dialled by the HEALTHCHECK and, since the move to Next standalone output (issue #291), also written as the image's `PORT` because the minimal server takes no command-line flags. Compose maps 7S40 onto it.",
  },
  {
    file: "docker/portal.Dockerfile",
    value: 3000,
    why: "same: the Next.js server's own in-container port, dialled by the HEALTHCHECK and, since the move to Next standalone output (issue #291), also written as the image's `PORT` because the minimal server takes no command-line flags. Compose maps 7S00 onto it.",
  },
  {
    file: "apps/api/src/openapi-document.ts",
    value: 5432,
    why: "Postgres's own well-known port, in an adopter-facing example connection string.",
  },
  {
    file: "apps/api/src/test-support.ts",
    value: 5432,
    why: "same: a placeholder connection string that no test ever dials.",
  },
  {
    file: "apps/api/src/telemetry.ts",
    value: 4318,
    why: "names the OTLP exporter's own default, which the gate in that file exists to avoid.",
  },
  {
    file: "apps/api/src/telemetry.test.ts",
    value: 4318,
    why: "same, asserted rather than described.",
  },
  {
    file: "apps/portal/instrumentation.ts",
    value: 4318,
    why: "same, in the portal's composition root.",
  },
  {
    file: "docs/ARCHITECTURE.md",
    value: 4318,
    why: "records why 'unconfigured' must mean silent: the exporter's default would dial this.",
  },
  {
    file: "apps/api/src/features/webhooks/ssrf.test.ts",
    value: 8443,
    why: "an arbitrary destination in an SSRF fixture URL: the point is that it is somewhere else, and nothing binds it.",
  },
  // The template copies are listed one by one rather than exempting the directory, so
  // a port introduced by a template transform is still caught.
  {
    file: "packages/create-qcms-app/templates/common/apps/api/src/main.ts",
    value: 3000,
    why: "the generated copy of apps/api/src/main.ts: the API's shipped default for adopters, which is exactly who this file is for.",
  },
  {
    file: "packages/create-qcms-app/templates/common/apps/api/src/openapi-document.ts",
    value: 5432,
    why: "the generated copy of apps/api/src/openapi-document.ts: Postgres's own well-known port, in an adopter-facing example connection string.",
  },
  {
    file: "packages/create-qcms-app/templates/common/apps/api/src/telemetry.ts",
    value: 4318,
    why: "the generated copy of apps/api/src/telemetry.ts: the OTLP exporter's own default, which that file's guard exists to avoid.",
  },
  {
    file: "packages/create-qcms-app/templates/common/apps/portal/instrumentation.ts",
    value: 4318,
    why: "the generated copy of apps/portal/instrumentation.ts: same OTLP default, in the portal's composition root.",
  },
  {
    file: "packages/create-qcms-app/templates/common/docker/api.Dockerfile.tmpl",
    value: 3000,
    why: "the generated copy of docker/api.Dockerfile: the container's OWN listening port, dialled by its HEALTHCHECK from inside the container.",
  },
  {
    file: "packages/create-qcms-app/templates/common/docker/admin.Dockerfile.tmpl",
    value: 3000,
    why: "the generated copy of docker/admin.Dockerfile: the Next.js server's own in-container port, dialled by the HEALTHCHECK and written as the image's `PORT`.",
  },
  {
    file: "packages/create-qcms-app/templates/common/docker/portal.Dockerfile.tmpl",
    value: 3000,
    why: "the generated copy of docker/portal.Dockerfile: the Next.js server's own in-container port, dialled by the HEALTHCHECK and written as the image's `PORT`.",
  },
  {
    file: ".github/actions/assert-no-docker-hub-pulls/action.yml",
    value: 5000,
    why: "the conventional local-registry port, named in a comment explaining how a registry host is recognised.",
  },
];

/**
 * Computed from `scripts/ports.mjs`, never listed, so the gate cannot drift from the
 * arithmetic it enforces and adding a service stays a one-place edit (ADR-37).
 */
export function sanctionedPorts() {
  const allowed = new Set();
  for (let seat = MIN_PORT_SEAT; seat <= MAX_PORT_SEAT; seat += 1) {
    for (const service of Object.keys(STABLE_SERVICES)) {
      allowed.add(stablePort(/** @type {keyof typeof STABLE_SERVICES} */ (service), seat));
    }
    for (const entry of harnessPorts(seat)) allowed.add(entry.port);
  }
  return allowed;
}

export function slotList(prefix, services) {
  return Object.entries(services)
    .map(([service, offset]) => `${prefix}${String(offset).padStart(2, "0")} ${service}`)
    .join("  ");
}

/**
 * Each entry must capture the port in group 1, except `list`, which captures a
 * comma-separated array body.
 *
 * @type {{ name: string; re: RegExp; list?: boolean }[]}
 */
const PATTERNS = [
  {
    name: "URL authority",
    re: /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)\s*:\s*([\d_]{2,7})\b/g,
  },
  { name: "--port flag", re: /--port[ =]([\d_]{2,7})\b/g },
  { name: "docker publish", re: /\s-p\s+([\d_]{2,7}):/g },
  {
    // Requires a separator or a case change before "port" so that `support`, `transport`,
    // `export` and `SUPPORT` cannot match.
    name: "port assignment",
    re: /(?:\bport|\bPort|_PORT|_port|[a-z]Port)\b"?\s*(?:=|\?\?|:)\s*"?([\d_]{2,7})\b/g,
  },
  {
    name: "devcontainer port array",
    re: /"(?:appPort|forwardPorts)"\s*:\s*\[([^\]]*)\]/g,
    list: true,
  },
  { name: "shell/compose default", re: /:-\s*([\d_]{2,7})\s*\}/g },
  { name: "prose", re: /\bport\s+([\d_]{4,5})\b/gi },
];

function tracked() {
  const out = execFileSync(GIT, ["ls-files", "-z", ...GLOBS, ...EXCLUDES], { encoding: "utf8" });
  return out.split("\0").filter((path) => path !== "");
}

/** Exact repo-relative path, never a substring or suffix - see ALLOWED above. */
export function exemption(file, value) {
  return ALLOWED.find((rule) => rule.file === file && rule.value === value)?.why;
}

export function portsIn(text) {
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, index) => {
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(line)) !== null) {
        const raw = match[1] ?? "";
        const values = pattern.list === true ? raw.split(",") : [raw];
        for (const value of values) {
          const port = Number(value.replaceAll("_", "").trim());
          if (!Number.isInteger(port) || port <= 0) continue;
          found.push({ port, line: index + 1, source: pattern.name });
        }
      }
    }
  });
  return found;
}

export function main() {
  const sanctioned = sanctionedPorts();
  const violations = [];

  for (const file of tracked()) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { port, line, source } of portsIn(text)) {
      if (sanctioned.has(port)) continue;
      if (exemption(file, port) !== undefined) continue;
      violations.push(`  ${file}:${line}  port ${String(port)}  (matched as: ${source})`);
    }
  }

  if (violations.length === 0) {
    console.log("check-ports: OK - every declared port is inside the QCMS allocation.");
    return 0;
  }

  console.error("check-ports: port(s) outside the QCMS allocation (R8, docs/PORTS.md):\n");
  for (const violation of violations.slice(0, 50)) console.error(violation);
  if (violations.length > 50) console.error(`  ... and ${violations.length - 50} more`);
  console.error(
    [
      "",
      "QCMS uses two blocks and nothing else, for machine seat S (QCMS_PORT_SEAT):",
      `  7Sxx   stable, human-facing  ${slotList("7S", STABLE_SERVICES)}`,
      `  17Sxx  ephemeral harness     ${slotList("17S", HARNESS_SERVICES)}`,
      "",
      "Derive the port from `scripts/ports.mjs` (stablePort / harnessPort) instead of",
      "writing a literal. If the number genuinely is not ours (a third-party image's",
      "own port, a container-internal port), add it to ALLOWED in this script with the",
      "reason. Never invent a port. See docs/PORTS.md.",
    ].join("\n"),
  );
  return 1;
}

// Guarded so the test can import the pure helpers without the scan firing.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
