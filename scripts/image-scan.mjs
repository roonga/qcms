#!/usr/bin/env node
// @ts-check
/**
 * Scans the SBOM the build already produced rather than the image, which needs no pull
 * and no registry credential: a branch publishes no image to pull back out of GHCR.
 * The cost is file locations, which the SPDX round-trip drops.
 *
 * `--fail-on` is the blocking floor and `--notify-on` the reporting floor, decoupled on
 * purpose. `--fail-on-unfixed` widens the blocking floor only, so a finding with no
 * published fix is always reported and never reds a job: the blocking floor is
 * fixable-only by default because the base image carries criticals with no fix in
 * Debian 12, and a floor nothing in this repository can clear is a floor people learn
 * to ignore. The open decision and the per-CVE evidence are in
 * `docs/SECURITY_DESIGN.md` §9.
 *
 * The vulnerability database is fetched at run time, so the same tree scans differently
 * on different days. That is only tolerable because the `Images` workflow publishes no
 * required context: a red scan reports beside a mergeable pull request. Moving this job
 * into a required context is a decision for the Code Owner.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { attestationFileName, IMAGES, SPDX_PREDICATE } from "./build-images.mjs";
import { REPOSITORY_ROOT } from "./docker.mjs";

/**
 * Spelled out rather than inferred so a severity grype starts emitting is a loud
 * failure instead of a finding that sorts below every floor and disappears.
 */
export const SEVERITIES = ["unknown", "negligible", "low", "medium", "high", "critical"];

/**
 * `wont-fix` and `not-fixed` mean this distribution has no fixed version, not that
 * upstream refuses to fix.
 */
export const FIXED = "fixed";

/**
 * "The floor was crossed" and "the scan did not work" must not share one code: a caller
 * that collapses them cannot tell a verdict from a broken run.
 */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_BLOCKED = 2;

/**
 * @param {string} severity
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
 * Accepts the in-toto statement the build persists or the bare SPDX document, because a
 * fixture is easier to write as the document itself.
 *
 * @param {any} statement
 * @returns {any}
 */
export function spdxDocument(statement) {
  return statement?.predicate ?? statement;
}

/**
 * Keyed off the purl and not SPDX's own `name`: the deb and npm halves of these images
 * share that field, and a purl is unambiguous about the ecosystem.
 *
 * @param {any} document
 * @returns {Record<string, number>}
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
 * @param {any} report
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
 * @param {ReturnType<typeof findings>} list
 * @param {string} floor
 * @param {boolean} includeUnfixed
 * @returns {ReturnType<typeof findings>}
 */
export function atOrAbove(list, floor, includeUnfixed) {
  const minimum = severityRank(floor);
  return list
    .filter(
      (finding) =>
        severityRank(finding.severity) >= minimum && (includeUnfixed || finding.fixState === FIXED),
    )
    .sort(
      (left, right) =>
        severityRank(right.severity) - severityRank(left.severity) ||
        left.id.localeCompare(right.id) ||
        left.name.localeCompare(right.name),
    );
}

/**
 * Three ways the scan goes green while meaning nothing, each a failure here instead: an
 * SBOM with no packages, a report with no vulnerability database behind it, and deb
 * packages in the SBOM with no distro in the report. The last is specific to scanning an
 * SBOM: without the distro the scanner matches the npm half and silently skips every
 * operating-system package.
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
  // Both halves are checked rather than the key's presence: a database that failed to
  // load reports `valid: false` and still answers.
  const database = report?.descriptor?.db?.status;
  if (typeof database?.built !== "string" || database.built === "") {
    throw new Error(
      `image-scan: ${image} has a report with no vulnerability database build date in \`descriptor.db.status.built\`. A report produced without a database is clean for the wrong reason; if the scanner's report shape has changed, this check has to change with it.`,
    );
  }
  if (database.valid === false) {
    throw new Error(
      `image-scan: ${image} was scanned against a vulnerability database the scanner itself reports as invalid (\`descriptor.db.status.valid\` is false).`,
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
 * @param {{ image: string, document: any, report: any }} input
 * @param {{ failOn: string, notifyOn: string, failOnUnfixed: boolean }} floors
 */
export function summarizeImage({ image, document, report }, floors) {
  const list = findings(report);
  const ecosystems = purlEcosystems(document);
  // `true` rather than `floors.failOnUnfixed`: the published-fix rule narrows what can
  // turn a job red and must never narrow what a person is shown.
  const reported = atOrAbove(list, floors.notifyOn, true);
  return {
    image,
    packages: Object.values(ecosystems).reduce((sum, count) => sum + count, 0),
    ecosystems,
    distro: `${String(report?.distro?.name ?? "")} ${String(report?.distro?.version ?? "")}`.trim(),
    counts: severityCounts(list),
    unfixed: list.filter((finding) => finding.fixState !== FIXED).length,
    blocking: atOrAbove(list, floors.failOn, floors.failOnUnfixed),
    reported,
    reportedFixable: reported.filter((finding) => finding.fixState === FIXED),
    reportedUnfixed: reported.filter((finding) => finding.fixState !== FIXED),
  };
}

/**
 * Every value here reaches the issue body from data. A `|` injects a column, a newline
 * ends the table, an `@name` notifies a person. The code span neutralises `#`, `@` and
 * `[`, but not the pipe or the newline inside a table, so those are handled first.
 *
 * @param {string} value
 * @returns {string}
 */
export const MAX_CELL_LENGTH = 200;

export function escapeCell(value) {
  const flattened = String(value)
    // U+2028 and U+2029 are line separators too, and a renderer honouring them ends the
    // row as surely as a newline does.
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    // A backtick would close the span this is about to open.
    .replaceAll("`", "'")
    // Backslashes before pipes: escaping only the pipe leaves a literal `\|` as `a\\|b`,
    // which GFM's table splitter and a proper escape parser read two different ways.
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .trim();
  if (flattened.length <= MAX_CELL_LENGTH) {
    return flattened === "" ? "``" : `\`${flattened}\``;
  }
  // Structural, not cosmetic: the scheduled job truncates the issue body, and without a
  // bound per cell that cut can land inside a code span and render the rest as code.
  const cut = flattened.slice(0, MAX_CELL_LENGTH - 3);
  // Never end on a lone backslash: it would escape the closing backtick.
  const trailing = /(\\*)$/.exec(cut)?.[1].length ?? 0;
  return `\`${trailing % 2 === 1 ? cut.slice(0, -1) : cut}...\``;
}

/**
 * The images share a base, so an unfiltered listing repeats every operating-system
 * finding once per image.
 *
 * @param {{ image: string }[]} summaries
 * @param {"blocking" | "reportedFixable" | "reportedUnfixed"} key
 */
export function mergeFindings(summaries, key) {
  /** @type {Map<string, any>} */
  const rows = new Map();
  for (const summary of summaries) {
    for (const finding of summary[key]) {
      const id = [
        finding.severity,
        finding.id,
        finding.ecosystem,
        finding.name,
        finding.version,
        finding.fixState,
      ].join("|");
      const existing = rows.get(id);
      if (existing === undefined) rows.set(id, { ...finding, images: [summary.image] });
      else existing.images.push(summary.image);
    }
  }
  return [...rows.values()].sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      left.id.localeCompare(right.id) ||
      left.name.localeCompare(right.name),
  );
}

function findingRow(row) {
  const fix =
    row.fixVersions.length > 0 ? `${row.fixState}: ${row.fixVersions.join(", ")}` : row.fixState;
  return `| ${escapeCell(row.severity)} | ${escapeCell(row.id)} | ${escapeCell(row.ecosystem)} | ${escapeCell(`${row.name}@${row.version}`)} | ${escapeCell(fix)} | ${row.images.join(", ")} |`;
}

/**
 * @param {ReturnType<typeof summarizeImage>[]} summaries
 * @param {{ failOn: string, notifyOn: string, failOnUnfixed: boolean }} floors
 * @returns {string}
 */
export function renderReport(summaries, floors) {
  const lines = [];
  const blockingScope = floors.failOnUnfixed
    ? "every finding, fix available or not"
    : "findings with a published fix";
  lines.push("## Image vulnerability scan");
  lines.push("");
  lines.push(
    `Scanner: grype, over the SPDX SBOM each image's build attached. Blocking floor \`${floors.failOn}\` (${blockingScope}); reporting floor \`${floors.notifyOn}\`, which always names every finding whether or not a fix exists.`,
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

  for (const [heading, key] of /** @type {const} */ ([
    [`Blocking: at or above \`${floors.failOn}\`, ${blockingScope}`, "blocking"],
    [`Reported: at or above \`${floors.notifyOn}\`, fix available`, "reportedFixable"],
    [
      `Reported: at or above \`${floors.notifyOn}\`, NO FIX AVAILABLE (not blocking, not accepted)`,
      "reportedUnfixed",
    ],
  ])) {
    const rows = mergeFindings(summaries, key);
    lines.push("");
    lines.push(`### ${heading}`);
    lines.push("");
    if (rows.length === 0) {
      lines.push("None.");
      continue;
    }
    lines.push("| Severity | Advisory | Ecosystem | Package | Fix | Images |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    lines.push(...rows.map(findingRow));
  }

  lines.push("");
  lines.push(
    "Triage: a `deb` finding is cleared by a base-image digest bump (Dependabot's `docker` ecosystem opens it; `docker/*.Dockerfile` carries the digest beside the tag), or, when Debian has published the fix and no base digest carries it yet, by an `--only-upgrade` of that one package in each runtime stage, which needs its own ruling per package and is in use for none today (issue #1047 covered `perl-base` until a published digest carried the fix, issue #969); an `npm` finding under `/usr/local/lib/node_modules/npm` by the same digest bump, and by nothing else, since that is npm's own bundled tree and it moves only when Node's bundled npm does; and an `npm` finding in the application tree by a dependency bump or a targeted entry in CONTRIBUTING > Security overrides, which is the removal-condition ledger. A finding with no fix in this distribution is recorded rather than accepted, and `wont-fix` is the scanner's label for that rather than upstream's verdict: see `docs/SECURITY_DESIGN.md` section 9 and `docs/operations.md`.",
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * Over the merged rows and not the Markdown, which carries counts that drift with
 * unrelated severities. The scheduled job stays silent while this does not move.
 *
 * @param {ReturnType<typeof summarizeImage>[]} summaries
 * @returns {string}
 */
export function reportDigest(summaries) {
  const rows = [
    ...mergeFindings(summaries, "blocking"),
    ...mergeFindings(summaries, "reportedFixable"),
    ...mergeFindings(summaries, "reportedUnfixed"),
  ].map((row) =>
    [
      row.severity,
      row.id,
      row.ecosystem,
      `${row.name}@${row.version}`,
      row.fixState,
      row.fixVersions.join(","),
      [...row.images].sort().join(","),
    ].join("|"),
  );
  return createHash("sha256")
    .update([...new Set(rows)].sort().join("\n"))
    .digest("hex");
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * `sbom:` keeps this off the registry, and grype refuses the in-toto envelope, so the
 * caller unwraps to bare SPDX first.
 *
 * No `--fail-on` at the scanner: grype exits 2 for a crossed floor and 1 for a database
 * error, so letting it own the verdict collapses the two. Here any non-zero exit from
 * grype is a failure to scan and the floors are this script's business.
 *
 * @param {string} scanner
 * @param {string} sbomPath
 * @param {string} reportPath
 * @returns {any}
 */
export function runScanner(scanner, sbomPath, reportPath) {
  execFileSync(scanner, [`sbom:${sbomPath}`, "--output", "json", "--file", reportPath], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  return JSON.parse(readFileSync(reportPath, "utf8"));
}

/**
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
  // Validated here rather than at first use: a typo in a floor must fail the run, not
  // read as "nothing crossed it".
  severityRank(failOn);
  severityRank(notifyOn);
  return {
    attestationRoot: value("--attestations", join(REPOSITORY_ROOT, "dist-attestations")),
    reportRoot: value("--report", join(REPOSITORY_ROOT, "dist-image-scan")),
    failOn,
    notifyOn,
    failOnUnfixed:
      argv.includes("--fail-on-unfixed") || env.QCMS_IMAGE_SCAN_FAIL_ON_UNFIXED === "true",
    scanner: value("--scanner", env.QCMS_GRYPE_BIN ?? "grype"),
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
    // Unwrapped onto disk beside the report, which is also what makes a finding
    // reproducible by hand.
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
  const blocking = mergeFindings(summaries, "blocking").length;
  writeFileSync(
    join(options.reportRoot, "summary.json"),
    `${JSON.stringify(
      {
        ...floors,
        blocking,
        reported: mergeFindings(summaries, "reportedFixable").length,
        reportedUnfixed: mergeFindings(summaries, "reportedUnfixed").length,
        digest: reportDigest(summaries),
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

  if (blocking > 0) {
    const scope = floors.failOnUnfixed
      ? "counting findings with no fix available, because --fail-on-unfixed is set"
      : "each with a published fix";
    process.stderr.write(
      `image-scan: ${String(blocking)} finding(s) at or above ${options.failOn}, ${scope}. Triage is in the summary above.\n`,
    );
    return EXIT_BLOCKED;
  }
  return EXIT_OK;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    // EXIT_ERROR and never EXIT_BLOCKED: nothing here is a verdict about the images.
    process.exitCode = EXIT_ERROR;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}
