#!/usr/bin/env node
// @ts-check
/**
 * Container-image vulnerability scanning, over the SBOM the build already produced
 * (issue #894, the open half of the #372 ruling).
 *
 * ## What was missing
 *
 * `docs/SECURITY_DESIGN.md` §9 recorded that no container-image vulnerability scanning
 * ran anywhere, so the security value of a base-image digest bump was argued from an
 * upstream changelog rather than measured. Two things made closing it cheap. #874
 * persists an SPDX SBOM per image as a workflow artifact, and #877 pruned the API
 * image's SBOM from 680 npm packages to 287, so a report over it is short enough to
 * read.
 *
 * ## Why the SBOM is the input, and not the image
 *
 * Scanning the SBOM needs **no image pull and no registry credential**. The three
 * in-toto documents are already on the runner's disk when the build step finishes, and
 * `grype sbom:<file>` reads one directly. Scanning the image instead would mean either
 * keeping the 376 MB of OCI directories alive across jobs or pulling the published
 * image back out of GHCR - and the second cannot work at all on a branch, because a
 * branch publishes nothing (`.github/workflows/images.yml`). The SBOM path gives every
 * push the same report.
 *
 * It costs one thing worth naming: file locations. The SPDX round-trip keeps each
 * package's `sourceInfo` string but drops the structured locations, so a finding names
 * the package and version rather than the path inside the image. The package is what a
 * fix is applied to, so that is the half that matters.
 *
 * ## The OS half of the scan is real, and this is how that is known
 *
 * The obvious failure mode for SBOM-based scanning is a report that quietly covers only
 * the npm packages: matching a Debian advisory needs the distro, and an SBOM format
 * that loses it leaves the scanner unable to match `pkg:deb/...` at all. The syft
 * document buildx attaches records the distro **on every deb purl** as a qualifier
 * (`pkg:deb/debian/libc6@2.36-9+deb12u14?arch=amd64&distro=debian-12.15`), grype
 * reconstructs it from there, and the report says so in its `distro` field. Measured on
 * the three images when this landed: `{"name":"debian","version":"12.15"}` and 220 of
 * the 229 matches against `deb` packages.
 *
 * That is not left to trust. {@link assertScanIsAnswerable} fails the scan when an SBOM
 * lists deb packages and the report names no distro, because that combination is
 * exactly a scan that has gone half-blind while still reporting a tidy npm-only result.
 *
 * ## What blocks, and what only reports
 *
 * Two floors, both configurable, and a third axis that is the reason the first one is
 * usable at all:
 *
 * - `--fail-on` (default `critical`) is the blocking floor. A finding at or above it
 *   fails this script, which fails the `scan` job in the `Images` workflow.
 * - `--notify-on` (default `high`) is the reporting floor. The scheduled run files or
 *   updates one labeled issue when anything reaches it, the way `audit.yml` does for
 *   `pnpm audit`.
 * - **Only a finding with a published fix can do either**, unless `--fail-on-unfixed`
 *   says otherwise. Every finding, fixable or not, is still counted in the summary and
 *   written to the artifact; what the flag decides is whether it can turn a job red.
 *
 * The third one is not a loophole, it is what makes a `critical` floor mean something.
 * Measured on `node:24-bookworm-slim` at the digest pinned when this landed, the base
 * image carries 7 critical findings, every one of them `wont-fix` or `not-fixed`
 * upstream: `libc6`, `libc-bin` and five against `perl-base`. A blocking floor that
 * counted those would be red on the day it landed and red every day after, with no
 * action anyone could take to clear it - the definition of a gate people learn to
 * ignore. A floor that counts only findings with a fix available is a floor that says
 * "a base digest bump, an override or a dependency bump will clear this", which is a
 * claim someone can act on. The unfixable ones are not hidden: they are in the counts,
 * in the artifact, and called out by name in `docs/SECURITY_DESIGN.md` §9.
 *
 * ## Why this cannot red an unrelated pull request
 *
 * The vulnerability database is fetched at run time, so the same tree scans differently
 * on different days: a CVE published this morning against `perl-base` changes the
 * verdict for every branch in flight, and nothing in the diff caused it. That is fine
 * here **because the `Images` workflow publishes no required context**. `protect-main`
 * requires exactly four (`verify (node-24)`, `api-e2e`, `browser-e2e`,
 * `full-stack-e2e`), and this job is in none of them, so a scan that goes red reports
 * beside a mergeable pull request rather than blocking it. That is the same position
 * `codeql.yml` and `audit.yml` occupy, and it is the property that lets the floor be a
 * real one rather than an advisory print-out. Moving this job into a required context
 * would make an upstream publication a merge blocker for unrelated work, and is a
 * decision for the Code Owner rather than a default.
 *
 * Usage:
 *   node scripts/image-scan.mjs --attestations <dir> --report <dir> [--fail-on critical]
 *                               [--notify-on high] [--fail-on-unfixed] [--scanner grype]
 *                               [--quiet]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { attestationFileName, IMAGES, SPDX_PREDICATE } from "./build-images.mjs";
import { REPOSITORY_ROOT } from "./docker.mjs";

/**
 * Grype's severity ladder, lowest first.
 *
 * Spelled out here rather than inferred, so that a severity string grype starts
 * emitting that is not on this list is a loud failure instead of a finding that sorts
 * below every floor and disappears. {@link severityRank} throws on an unknown name for
 * exactly that reason.
 */
export const SEVERITIES = ["unknown", "negligible", "low", "medium", "high", "critical"];

/** The fix states grype reports; only `fixed` means a published fix exists. */
export const FIXED = "fixed";

/**
 * Where a severity sits on the ladder.
 *
 * @param {string} severity case-insensitive; grype capitalises ("High").
 * @returns {number}
 */
export function severityRank(severity) {
  const index = SEVERITIES.indexOf(String(severity).toLowerCase());
  if (index === -1) {
    throw new Error(
      `image-scan: unknown severity ${JSON.stringify(severity)}. The scanner's ladder has changed; extend SEVERITIES rather than letting an unrecognised severity sort below every floor.`,
    );
  }
  return index;
}

/**
 * The SPDX document inside a buildx attestation.
 *
 * The persisted file is the in-toto statement, whose `predicate` is the SPDX document;
 * a fixture is easier to write as the document itself. Both are accepted, the same way
 * `scripts/image-dev-deps.mjs` accepts both.
 *
 * @param {any} statement
 * @returns {any}
 */
export function spdxDocument(statement) {
  return statement?.predicate ?? statement;
}

/**
 * How many packages an SPDX document lists, per purl ecosystem.
 *
 * The purl and not SPDX's own `name`, for the reason `image-dev-deps.mjs` records: a
 * purl is unambiguous about the ecosystem, and the deb and npm halves of these images
 * share the field otherwise.
 *
 * @param {any} document an in-toto statement, or the SPDX document.
 * @returns {Record<string, number>} keyed `npm`, `deb`, `generic`, ...
 */
export function purlEcosystems(document) {
  const spdx = spdxDocument(document);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const entry of spdx?.packages ?? []) {
    for (const reference of entry.externalRefs ?? []) {
      const locator = reference.referenceLocator;
      if (typeof locator !== "string" || !locator.startsWith("pkg:")) continue;
      const ecosystem = locator.slice("pkg:".length).split("/")[0];
      counts[ecosystem] = (counts[ecosystem] ?? 0) + 1;
      break;
    }
  }
  return counts;
}

/**
 * A grype JSON report as the flat finding list the rest of this file works with.
 *
 * @param {any} report parsed `grype --output json`.
 * @returns {{ id: string, severity: string, ecosystem: string, name: string,
 *   version: string, fixState: string, fixVersions: string[] }[]}
 */
export function findings(report) {
  return (report?.matches ?? []).map((/** @type {any} */ match) => ({
    id: String(match?.vulnerability?.id ?? ""),
    severity: String(match?.vulnerability?.severity ?? ""),
    ecosystem: String(match?.artifact?.type ?? ""),
    name: String(match?.artifact?.name ?? ""),
    version: String(match?.artifact?.version ?? ""),
    fixState: String(match?.vulnerability?.fix?.state ?? "unknown"),
    fixVersions: (match?.vulnerability?.fix?.versions ?? []).map(String),
  }));
}

/**
 * How many findings sit at each severity.
 *
 * Every rung is present with a zero, so the summary table has the same columns for an
 * image with nothing wrong as for one with everything wrong.
 *
 * @param {ReturnType<typeof findings>} list
 * @returns {Record<string, number>}
 */
export function severityCounts(list) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of list) counts[SEVERITIES[severityRank(finding.severity)]] += 1;
  return counts;
}

/**
 * The findings a floor selects.
 *
 * @param {ReturnType<typeof findings>} list
 * @param {string} floor a severity name.
 * @param {boolean} includeUnfixed when false, only a finding with a published fix counts.
 * @returns {ReturnType<typeof findings>} sorted by severity, then id, then package.
 */
export function atOrAbove(list, floor, includeUnfixed) {
  const minimum = severityRank(floor);
  return list
    .filter(
      (finding) =>
        severityRank(finding.severity) >= minimum &&
        (includeUnfixed || finding.fixState === FIXED),
    )
    .sort(
      (left, right) =>
        severityRank(right.severity) - severityRank(left.severity) ||
        left.id.localeCompare(right.id) ||
        left.name.localeCompare(right.name),
    );
}

/**
 * Refuse a scan that cannot answer the question it was asked.
 *
 * Three ways this check dies quietly, all of them ending in a green report that means
 * nothing, and all three are failures here instead:
 *
 * 1. **An SBOM with no packages.** A shape change upstream, or the wrong file, and
 *    every floor is trivially clear. `scripts/image-dev-deps.mjs` refuses the same way.
 * 2. **A report with no database behind it.** `descriptor.db` records what matched; an
 *    absent one means the scanner answered without a vulnerability database.
 * 3. **Deb packages in the SBOM and no distro in the report.** This is the failure mode
 *    specific to scanning an SBOM rather than an image: without the distro, a scanner
 *    matches the npm half and silently skips every operating-system package, which on
 *    these images is 220 of 229 findings.
 *
 * @param {{ image: string, document: any, report: any }} input
 */
export function assertScanIsAnswerable({ image, document, report }) {
  const ecosystems = purlEcosystems(document);
  const total = Object.values(ecosystems).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    throw new Error(
      `image-scan: ${image} has an SBOM listing no packages with a purl at all, so the scan cannot answer what is in the image. Check the SBOM shape before trusting a clean report.`,
    );
  }
  if (report?.descriptor?.db === undefined || report.descriptor.db === null) {
    throw new Error(
      `image-scan: ${image} has a report with no vulnerability database recorded in \`descriptor.db\`. A report produced without a database is clean for the wrong reason.`,
    );
  }
  const distro = report?.distro?.name;
  if ((ecosystems.deb ?? 0) > 0 && (typeof distro !== "string" || distro === "")) {
    throw new Error(
      `image-scan: ${image} lists ${String(ecosystems.deb)} operating-system (deb) packages and the report names no distro, so no Debian advisory can have matched. The distro reaches the scanner as the \`distro=\` qualifier on each deb purl; an SBOM that has lost it produces an npm-only report that looks clean.`,
    );
  }
}

/**
 * One image's scan, reduced to what the summary and the exit code need.
 *
 * @param {{ image: string, document: any, report: any }} input
 * @param {{ failOn: string, notifyOn: string, failOnUnfixed: boolean }} floors
 */
export function summarizeImage({ image, document, report }, floors) {
  const list = findings(report);
  const ecosystems = purlEcosystems(document);
  return {
    image,
    packages: Object.values(ecosystems).reduce((sum, count) => sum + count, 0),
    ecosystems,
    distro: `${String(report?.distro?.name ?? "")} ${String(report?.distro?.version ?? "")}`.trim(),
    counts: severityCounts(list),
    unfixed: list.filter((finding) => finding.fixState !== FIXED).length,
    blocking: atOrAbove(list, floors.failOn, floors.failOnUnfixed),
    notifying: atOrAbove(list, floors.notifyOn, floors.failOnUnfixed),
  };
}

/** One finding as a table row body, shared by the two lists below. */
function findingRow(image, finding) {
  const fix = finding.fixVersions.length > 0 ? finding.fixVersions.join(", ") : finding.fixState;
  return `| ${image} | ${finding.severity} | ${finding.id} | ${finding.ecosystem} | ${finding.name}@${finding.version} | ${fix} |`;
}

/**
 * The Markdown report: one summary table, then the findings that cross a floor.
 *
 * This is what the workflow artifact carries and what the scheduled run puts in the
 * issue body, so it has to read on its own without the run log beside it.
 *
 * @param {ReturnType<typeof summarizeImage>[]} summaries
 * @param {{ failOn: string, notifyOn: string, failOnUnfixed: boolean }} floors
 * @returns {string}
 */
export function renderReport(summaries, floors) {
  const lines = [];
  const scope = floors.failOnUnfixed ? "every finding" : "findings with a published fix";
  lines.push("## Image vulnerability scan");
  lines.push("");
  lines.push(
    `Scanner: grype, over the SPDX SBOM each image's build attached. Blocking floor \`${floors.failOn}\`, reporting floor \`${floors.notifyOn}\`, applied to ${scope}.`,
  );
  lines.push("");
  lines.push(`| Image | Distro | Packages | ${SEVERITIES.map(capitalise).join(" | ")} | No fix |`);
  lines.push(`| --- | --- | --- | ${SEVERITIES.map(() => "---").join(" | ")} | --- |`);
  for (const summary of summaries) {
    const counts = SEVERITIES.map((severity) => String(summary.counts[severity])).join(" | ");
    lines.push(
      `| ${summary.image} | ${summary.distro} | ${String(summary.packages)} | ${counts} | ${String(summary.unfixed)} |`,
    );
  }

  for (const [floor, key, heading] of /** @type {const} */ ([
    [floors.failOn, "blocking", "Blocking"],
    [floors.notifyOn, "notifying", "Reported"],
  ])) {
    const rows = summaries.flatMap((summary) =>
      summary[key].map((finding) => findingRow(summary.image, finding)),
    );
    lines.push("");
    lines.push(`### ${heading}: at or above \`${floor}\`, ${scope}`);
    lines.push("");
    if (rows.length === 0) {
      lines.push("None.");
      continue;
    }
    lines.push("| Image | Severity | Advisory | Ecosystem | Package | Fixed in |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    lines.push(...rows);
  }

  lines.push("");
  lines.push(
    "Triage: a `deb` finding is cleared by a base-image digest bump (Dependabot's `docker` ecosystem opens it; `docker/*.Dockerfile` carries the digest beside the tag), an `npm` finding under `/usr/local/lib/node_modules/npm` by the same bump, and an `npm` finding in the application tree by a dependency bump or a targeted entry in CONTRIBUTING > Security overrides, which is the removal-condition ledger. A finding with no fix available is recorded rather than accepted: see `docs/SECURITY_DESIGN.md` section 9.",
  );
  lines.push("");
  return lines.join("\n");
}

/** `high` to `High`, for the table header. */
function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Run the scanner over one SPDX file.
 *
 * `sbom:` is grype's explicit scheme for a local SBOM document, which is what keeps
 * this off the registry entirely. The full JSON is kept - no severity filtering at the
 * scanner - so the artifact carries every finding and only the floors above decide what
 * turns a job red.
 *
 * @param {string} scanner the grype binary.
 * @param {string} sbomPath
 * @param {string} reportPath
 * @returns {any} the parsed report.
 */
export function runScanner(scanner, sbomPath, reportPath) {
  execFileSync(scanner, [`sbom:${sbomPath}`, "--output", "json", "--file", reportPath], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  return JSON.parse(readFileSync(reportPath, "utf8"));
}

/**
 * Read `--attestations`, `--report`, the two floors and the scanner out of the argv.
 *
 * The floors also read from the environment, so the workflow can move one without
 * editing a command line, which is what "configurable" has to mean for a value a Code
 * Owner may want to change without touching this file.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 */
export function parseArgv(argv, env = process.env) {
  const value = (flag, fallback) => {
    const index = argv.indexOf(flag);
    if (index === -1) return fallback;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`image-scan: ${flag} needs a value, for example ${flag} ${fallback}`);
    }
    return next;
  };
  const failOn = value("--fail-on", env.QCMS_IMAGE_SCAN_FAIL_ON ?? "critical");
  const notifyOn = value("--notify-on", env.QCMS_IMAGE_SCAN_NOTIFY_ON ?? "high");
  // Validate both here rather than at first use: a typo in a floor must fail the run
  // immediately, not read as "nothing crossed it".
  severityRank(failOn);
  severityRank(notifyOn);
  return {
    attestationRoot: value("--attestations", join(REPOSITORY_ROOT, "dist-attestations")),
    reportRoot: value("--report", join(REPOSITORY_ROOT, "dist-image-scan")),
    failOn,
    notifyOn,
    failOnUnfixed: argv.includes("--fail-on-unfixed") || env.QCMS_IMAGE_SCAN_FAIL_ON_UNFIXED === "true",
    scanner: value("--scanner", env.QCMS_GRYPE_BIN ?? "grype"),
    // The Markdown also goes to stdout, because the run log answering "what was in
    // that build" is the same property the build step's own report step has. Tests
    // turn it off so six fixture reports do not bury the rest of `pnpm verify`.
    quiet: argv.includes("--quiet"),
  };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgv(argv, env);
  const floors = {
    failOn: options.failOn,
    notifyOn: options.notifyOn,
    failOnUnfixed: options.failOnUnfixed,
  };
  mkdirSync(options.reportRoot, { recursive: true });

  const summaries = IMAGES.map((image) => {
    const attestation = join(
      options.attestationRoot,
      image.name,
      attestationFileName(SPDX_PREDICATE),
    );
    if (!existsSync(attestation)) {
      throw new Error(
        `image-scan: ${image.name} has no persisted SBOM at ${attestation}. Build with \`pnpm qcms:build-images -- --attestations <dir>\` first.`,
      );
    }
    // The scanner reads SPDX, not in-toto, so the statement is unwrapped onto disk
    // beside the report. That file is also what makes a finding reproducible by hand.
    const document = spdxDocument(JSON.parse(readFileSync(attestation, "utf8")));
    const sbomPath = join(options.reportRoot, `${image.name}.spdx.json`);
    writeFileSync(sbomPath, JSON.stringify(document));
    const reportPath = join(options.reportRoot, `${image.name}.grype.json`);
    const report = runScanner(options.scanner, sbomPath, reportPath);
    assertScanIsAnswerable({ image: image.name, document, report });
    return summarizeImage({ image: image.name, document, report }, floors);
  });

  const markdown = renderReport(summaries, floors);
  writeFileSync(join(options.reportRoot, "summary.md"), markdown);
  // The machine-readable half, so the scheduled job decides whether to file an issue
  // without parsing the Markdown it is about to paste.
  writeFileSync(
    join(options.reportRoot, "summary.json"),
    `${JSON.stringify(
      {
        ...floors,
        blocking: summaries.reduce((sum, summary) => sum + summary.blocking.length, 0),
        notifying: summaries.reduce((sum, summary) => sum + summary.notifying.length, 0),
        images: summaries.map(({ image, distro, packages, counts, unfixed }) => ({
          image,
          distro,
          packages,
          counts,
          unfixed,
        })),
      },
      null,
      2,
    )}\n`,
  );
  if (!options.quiet) process.stdout.write(`${markdown}\n`);

  const blocking = summaries.reduce((sum, summary) => sum + summary.blocking.length, 0);
  if (blocking > 0) {
    process.stderr.write(
      `image-scan: ${String(blocking)} finding(s) at or above ${options.failOn} with a published fix. Triage is in the summary above.\n`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}
