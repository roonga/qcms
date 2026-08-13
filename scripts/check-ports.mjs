#!/usr/bin/env node
// @ts-check
/**
 * Port-allocation gate (R8, ADR-37, issue #255).
 *
 * QCMS allocates two blocks and nothing else, per machine seat `S`
 * (`QCMS_PORT_SEAT`, default 0):
 *
 *   - `7Sxx`  stable, long-running, human-facing services
 *   - `17Sxx` ephemeral test harness, per seat
 *
 * The full table, the reasoning and the runbook are in `docs/PORTS.md`. This gate
 * exists because the rule was violated the moment it was only folklore: the harness
 * ports drifted to 3100/3200/4010/4319 and two agent lanes silently shared servers.
 * A rule with no gate is the state we were already in.
 *
 * ## What it looks for, and what it deliberately does not
 *
 * It does NOT scan for bare numbers. Four-digit integers are everywhere in this repo
 * (years, byte caps, timeouts, pixel sizes) and a gate that fired on those would be
 * disabled within a week. Instead it matches a number only where the surrounding
 * syntax says "this is a port":
 *
 *   1. a URL authority: `localhost:NNNN`, `127.0.0.1:NNNN`, `0.0.0.0:NNNN`,
 *      `[::1]:NNNN`, `host.docker.internal:NNNN`
 *   2. a `--port NNNN` / `--port=NNNN` flag
 *   3. a `docker run -p NNNN:` publish (the HOST side only; the container side is
 *      the image's own business and is never a QCMS allocation)
 *   4. an assignment or property whose name is `port`, `*_PORT`, or `*Port`
 *   5. a devcontainer `appPort` / `forwardPorts` array
 *   6. a Compose-style `${VAR:-NNNN}` default
 *   7. the prose form `port NNNN`, so a stale number in a doc is caught too
 *
 * Coverage is tracked text: `.ts .tsx .js .jsx .mjs .cjs .md .yml .yaml .sh`, plus
 * the named JSON/env files where ports genuinely get declared
 * (`.devcontainer/devcontainer.json`, every `.env.example`). Vendored components and
 * `plan/**` (a scratch/history area, like the other gates) are excluded. Broad
 * `.json` is excluded on purpose: the append-only golden corpus (ADR-18) must never
 * be edited, so a gate must not be able to demand it.
 *
 * Anything genuinely exempt is in ALLOWED below, each with its reason inline, and
 * each pinned to a specific file so an exemption cannot leak elsewhere.
 *
 * ## What it cannot see
 *
 * Written down because an unwritten limit is how a gate gets trusted beyond its
 * reach: that is precisely how the #74 GHCR mirror stayed bypassed inside `verify`
 * for weeks. Measured evasions, all of which pass a clean run today:
 *
 *   - `const PORT = 9998;` - a bare all-caps `PORT` is not in the identifier
 *     alternation, which covers `port`, `Port`, `_PORT` and `xPort` but not a
 *     standalone `PORT`.
 *   - a `--port NNNN` flag inside `package.json` - a shape the scanner DOES
 *     recognise, in a file it does not read. Broad `.json` is excluded on purpose
 *     (the append-only golden corpus must never be editable by a gate's demand) and
 *     the named-file list does not include `package.json`. So this one is a coverage
 *     gap, not a pattern gap, which is the cheaper of the two to close if it ever
 *     bites.
 *   - `- "9988:5432"` in a Compose file - only the `${VAR:-NNNN}` default form is
 *     scanned, not a bare publish mapping, which is the very form
 *     `docker-compose.dev.yml` uses for its own port.
 *
 * Inherently out of reach, and not worth chasing: a port built by arithmetic or
 * assembled in a template literal. Deriving it from `scripts/ports.mjs` is the only
 * thing that makes those safe, which is why R8 is a rule about derivation rather
 * than a rule about literals.
 *
 * Treat a clean run as "no port written in one of the recognised shapes", never as
 * "no port outside the allocation exists".
 *
 * Usage:  node scripts/check-ports.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

import {
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  STABLE_SERVICES,
  harnessPorts,
  stablePort,
} from "./ports.mjs";

const GIT = "git";

/** Tracked text where a port could plausibly be written down. */
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
  ".devcontainer/devcontainer.json",
  "*.env.example",
  ".env.example",
];

/** Areas the other gates also skip: vendored upstream code and the scratch area. */
const EXCLUDES = [":!packages/ui/src/components/**", ":!plan/**"];

/**
 * Ports that are legitimately not ours, pinned to the file that may say so.
 *
 * `file` is the **exact repo-relative path**, compared with `===`. Not a substring,
 * and not a suffix. Two reasons, and they matter more here than in ordinary code
 * because this is the gate itself: a substring test silently exempts any path that
 * merely contains an entry (`docs/PORTS.md.bak`, `vendor/docs/PORTS.md`), so a real
 * violation is waved through and the run still prints "OK" - the one failure mode a
 * gate exists to prevent, and invisible when it happens. And every entry below is
 * already a full repo-relative path, so exactness costs nothing and makes an
 * exemption unambiguously about one file.
 *
 * **Every entry here fires**, and `check-ports.test.ts` fails if one stops. Written
 * defensively during the migration, this list grew 8 entries the scan could never
 * reach: numbers sitting in prose the gate deliberately does not scan, and the
 * container side of a publish mapping, which no pattern captures. A dead exemption
 * is not harmless - it reads as evidence the gate inspects that file, which is the
 * misreading `docs/PORTS.md` had to warn about in prose. Pinning the list to what
 * actually fires makes the warning unnecessary: if an entry goes dead because the
 * file was reworded, delete it rather than restoring the number.
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
    file: "docs/PROJECT_GOAL.md",
    value: 4318,
    why: "same reasoning inside ADR-34.",
  },
  {
    file: "docs/features/054-observability-otel-baseline.md",
    value: 4318,
    why: "same reasoning inside the task that implemented ADR-34.",
  },
  {
    file: "docs/features/001-repo-bootstrap.md",
    value: 5432,
    why: "a completed work order, recording the connection string of the day. History, not live configuration.",
  },
  {
    file: "apps/api/src/features/webhooks/ssrf.test.ts",
    value: 8443,
    why: "an arbitrary destination in an SSRF fixture URL: the point is that it is somewhere else, and nothing binds it.",
  },
  {
    file: ".github/actions/assert-no-docker-hub-pulls/action.yml",
    value: 5000,
    why: "the conventional local-registry port, named in a comment explaining how a registry host is recognised.",
  },
];

/**
 * Every port the allocation sanctions, across all seats.
 *
 * Computed from `scripts/ports.mjs` rather than listed, so the gate can never drift
 * from the arithmetic it is enforcing.
 *
 * The stable services are read from `STABLE_SERVICES` itself rather than named here.
 * They used to be a literal list, which made the allocation a TWO-place edit while
 * ADR-37 says adding a service to that table is all it takes: a slot added there and
 * not here produced a gate that rejected the very port the ADR had just allocated,
 * with an error telling the author to move it back inside the allocation it was
 * already inside. The harness half was already derived this way.
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

/**
 * Where a number counts as a port. Each entry captures the port in group 1, except
 * `list`, which captures a comma-separated array body.
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
    // Only an identifier that IS `port`, ends `_PORT`/`_port`, or is camelCase
    // `xPort`. Written this way so `support`, `transport`, `export` and `SUPPORT`
    // cannot match: in those the letters before "port" are word characters with no
    // separator and no case change.
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

/** @returns {string[]} tracked files this gate covers. */
function tracked() {
  const out = execFileSync(GIT, ["ls-files", "-z", ...GLOBS, ...EXCLUDES], { encoding: "utf8" });
  return out.split("\0").filter((path) => path !== "");
}

/**
 * The exemption reason for `file` and `value`, when one applies.
 *
 * Exact repo-relative path, never a substring or suffix - see ALLOWED above for why.
 *
 * @param {string} file repo-relative path, as `git ls-files` reports it.
 * @param {number} value the port found in that file.
 * @returns {string | undefined}
 */
export function exemption(file, value) {
  return ALLOWED.find((rule) => rule.file === file && rule.value === value)?.why;
}

/**
 * Every port-shaped number in `text`, with the line it sits on.
 *
 * @param {string} text
 * @returns {{ port: number; line: number; source: string }[]}
 */
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

/** Run the gate over the tracked tree. Returns the process exit code. */
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
      "  7Sxx   stable, human-facing   7S00 portal  7S10 api  7S20 postgres  7S30 artifacts  7S40 admin",
      "  17Sxx  ephemeral harness      17S00 portal 17S10 api 17S30 otlp     17S40 admin",
      "",
      "Derive the port from `scripts/ports.mjs` (stablePort / harnessPort) instead of",
      "writing a literal. If the number genuinely is not ours (a third-party image's",
      "own port, a container-internal port), add it to ALLOWED in this script with the",
      "reason. Never invent a port. See docs/PORTS.md.",
    ].join("\n"),
  );
  return 1;
}

// Only when run as a command, so `check-ports.test.ts` can import the pure helpers
// above without the scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
