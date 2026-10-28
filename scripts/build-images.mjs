/**
 * Build the three QCMS images with a real version stamp and an SBOM.
 *
 * buildx needs the docker-container driver, because the default `docker` driver
 * cannot attach attestations. The SBOM step pulls `docker/buildkit-syft-scanner`, so
 * a CI job running this must not assert against Docker Hub pulls.
 *
 * Every assertion walks the exported OCI directory rather than checking which flags
 * were passed, and both the SBOM's presence and its contents are asserted BEFORE
 * {@link pushImage}: a check that runs after the push is a report, not a gate.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { captureProcess, DOCKER, REPOSITORY_ROOT, runProcess } from "./docker.mjs";
import { assertNoDevDependencies } from "./image-dev-deps.mjs";

export const IMAGES = [
  { name: "qcms-api", dockerfile: "docker/api.Dockerfile" },
  { name: "qcms-portal", dockerfile: "docker/portal.Dockerfile" },
  { name: "qcms-admin", dockerfile: "docker/admin.Dockerfile" },
];

/** The buildx builder this script creates on demand; the default driver cannot attest. */
const BUILDER = "qcms-sbom";

/**
 * GHCR and not Docker Hub: a push authenticates with the built-in `GITHUB_TOKEN`, so
 * publishing introduces no credential anyone has to store or rotate.
 */
export const REGISTRY = "ghcr.io";

export const SPDX_PREDICATE = "https://spdx.dev/Document";
export const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
export const VERSION_LABEL = "org.opencontainers.image.version";

/**
 * Both halves are needed: the package version alone repeats across every build
 * between two releases, the SHA alone does not say which release line this is. A
 * dirty tree is marked, because the label is the only place that fact survives.
 *
 * @returns {string}
 */
export function imageVersion(env = process.env) {
  const override = env.QCMS_IMAGE_VERSION;
  if (override !== undefined && override !== "") return override;
  const pkg = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
  const dirty =
    execFileSync("git", ["status", "--porcelain"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    }).trim() !== "";
  return `${pkg.version}+${sha}${dirty ? ".dirty" : ""}`;
}

/**
 * A tag cannot carry SemVer's `+`, and the replacement must be `_` for injectivity:
 * `-` is legal in a SemVer version, so `1.0.0+build.5` and `1.0.0-build.5` would
 * collide on one tag and the second build would silently move the first one's.
 *
 * @param {string} version
 * @returns {string}
 */
export function imageTag(version) {
  return version.replaceAll("+", "_");
}

export function ensureBuilder() {
  const existing = captureProcess(DOCKER, ["buildx", "ls", "--format", "{{.Name}}"]);
  if (existing.split("\n").includes(BUILDER)) return;
  runProcess(DOCKER, ["buildx", "create", "--name", BUILDER, "--driver", "docker-container"]);
}

/**
 * @param {string} directory
 * @param {string} digest
 * @returns {string}
 */
function ociBlobPath(directory, digest) {
  return join(directory, "blobs", "sha256", digest.replace("sha256:", ""));
}

/**
 * @param {string} directory
 * @param {string} digest
 * @returns {any}
 */
function readOciBlob(directory, digest) {
  return JSON.parse(readFileSync(ociBlobPath(directory, digest), "utf8"));
}

/**
 * One walk, two readers, so the label reader and the blob reader cannot come to
 * disagree about which entry is the attestation.
 *
 * @param {string} directory
 * @returns {{ entry: any, manifest: any }[]}
 */
function ociManifests(directory) {
  const index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
  const manifestList = readOciBlob(directory, index.manifests[0].digest);
  return manifestList.manifests.map((/** @type {any} */ entry) => ({
    entry,
    manifest: readOciBlob(directory, entry.digest),
  }));
}

const PREDICATE_ANNOTATION = "in-toto.io/predicate-type";

/**
 * @param {string} directory
 * @returns {{ labels: Record<string, string>, predicates: string[] }}
 */
export function inspectOciArtifact(directory) {
  /** @type {string[]} */
  const predicates = [];
  /** @type {Record<string, string>} */
  let labels = {};

  for (const { entry, manifest } of ociManifests(directory)) {
    if (entry.platform?.architecture === "unknown") {
      for (const layer of manifest.layers ?? []) {
        const predicate = layer.annotations?.[PREDICATE_ANNOTATION];
        if (predicate !== undefined) predicates.push(predicate);
      }
      continue;
    }
    labels = readOciBlob(directory, manifest.config.digest).config?.Labels ?? {};
  }
  return { labels, predicates };
}

/**
 * @param {string} directory
 * @returns {{ predicate: string, path: string }[]}
 */
export function attestationBlobs(directory) {
  /** @type {{ predicate: string, path: string }[]} */
  const found = [];
  for (const { entry, manifest } of ociManifests(directory)) {
    if (entry.platform?.architecture !== "unknown") continue;
    for (const layer of manifest.layers ?? []) {
      const predicate = layer.annotations?.[PREDICATE_ANNOTATION];
      if (predicate !== undefined) {
        found.push({ predicate, path: ociBlobPath(directory, layer.digest) });
      }
    }
  }
  return found;
}

/**
 * The scheme goes and path separators become hyphens, so the name is legal on every
 * filesystem a CI artifact is unpacked on: `https://spdx.dev/Document` becomes
 * `spdx.dev-Document.json`.
 *
 * @param {string} predicate
 * @returns {string}
 */
export function attestationFileName(predicate) {
  return `${predicate.replace(/^https?:\/\//, "").replaceAll("/", "-")}.json`;
}

/**
 * The destination is removed before each copy: an OCI blob is written read-only
 * (0444) and `copyFileSync` inherits that mode, so a second run into the same
 * directory would fail with EACCES on a file this function itself wrote.
 *
 * @param {string} directory
 * @param {string} name
 * @param {string} outputRoot
 * @returns {string[]} the files written.
 */
export function saveAttestations(directory, name, outputRoot) {
  const target = join(outputRoot, name);
  mkdirSync(target, { recursive: true });
  return attestationBlobs(directory).map(({ predicate, path }) => {
    const file = join(target, attestationFileName(predicate));
    rmSync(file, { force: true });
    copyFileSync(path, file);
    return file;
  });
}

/**
 * Separate from {@link assertArtifact} because it reads the attestation's BODY rather
 * than its descriptor. Both run before a push.
 *
 * @param {string} directory
 * @param {string} name
 * @returns {number} how many npm packages the SBOM listed, for the build log.
 */
export function assertNoDevPackages(directory, name) {
  const sbom = attestationBlobs(directory).find(({ predicate }) => predicate === SPDX_PREDICATE);
  if (sbom === undefined) {
    // Unreachable through buildImage; a direct caller gets this message rather than a
    // TypeError.
    throw new Error(`build-images: ${name} has no SBOM (${SPDX_PREDICATE}) to read`);
  }
  return assertNoDevDependencies(JSON.parse(readFileSync(sbom.path, "utf8")), name);
}

/**
 * @param {string} directory
 * @param {string} version
 * @param {string} name
 */
export function assertArtifact(directory, version, name) {
  const { labels, predicates } = inspectOciArtifact(directory);
  const problems = [];
  // Whole-element equality spelled out: CodeQL reads `.includes()` on these URL-shaped
  // values as `String.prototype.includes` and reports incomplete sanitization.
  if (!predicates.some((predicate) => predicate === SPDX_PREDICATE)) {
    problems.push(`no SBOM (${SPDX_PREDICATE})`);
  }
  if (!predicates.some((predicate) => predicate === PROVENANCE_PREDICATE)) {
    problems.push(`no provenance (${PROVENANCE_PREDICATE})`);
  }
  const stamped = labels[VERSION_LABEL];
  if (stamped !== version) {
    problems.push(
      `${VERSION_LABEL} is ${JSON.stringify(stamped)}, expected ${JSON.stringify(version)}`,
    );
  }
  if (stamped === "dev") problems.push("the version stamp is still the Dockerfile default");
  if (problems.length > 0) {
    throw new Error(
      `build-images: ${name} failed its supply-chain assertions:\n  ${problems.join("\n  ")}`,
    );
  }
}

/**
 * One function for both the local build and the push, so the two cannot drift on the
 * flags that decide what the artifact contains. Only `--tag` and `--output` differ,
 * and neither is part of the build graph, so the push re-exports from cache.
 *
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {{ tags: string[], output: string }} exporter
 * @returns {string[]}
 */
export function buildArgv(image, version, { tags, output }) {
  return [
    "buildx",
    "build",
    "--builder",
    BUILDER,
    "--file",
    image.dockerfile,
    "--build-arg",
    `VERSION=${version}`,
    "--sbom=true",
    "--provenance=mode=max",
    ...tags.flatMap((tag) => ["--tag", tag]),
    "--output",
    output,
    ".",
  ];
}

/**
 * A repository path must be lowercase and a tag is `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}`.
 * Both are checked here rather than left to the registry, because a rejected push in
 * CI reads as an infrastructure failure instead of as the mistake it is.
 *
 * @param {string} namespace
 * @param {string} name
 * @param {string[]} tags
 * @returns {string[]}
 */
export function imageReferences(namespace, name, tags) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(namespace)) {
    throw new Error(
      `build-images: ${JSON.stringify(namespace)} is not a legal registry namespace; it must be lowercase`,
    );
  }
  if (tags.length === 0) throw new Error("build-images: --push needs at least one --tag");
  for (const tag of tags) {
    if (!/^\w[\w.-]{0,127}$/.test(tag)) {
      throw new Error(`build-images: ${JSON.stringify(tag)} is not a legal image tag`);
    }
  }
  return tags.map((tag) => `${REGISTRY}/${namespace}/${name}:${tag}`);
}

/**
 * A CONJUNCTION of every descriptor property buildx writes, because this is the one
 * assertion the push path exists for and a permissive test would report success on an
 * artifact that lost its attestations. The `unknown/unknown` platform is a convention
 * another non-image entry could adopt; only the annotation names this entry as the
 * attestation for a specific image.
 *
 * @param {string} rawManifestList
 * @returns {number} how many attestation manifests the list carries.
 */
export function attestationManifestCount(rawManifestList) {
  /** @type {{ manifests?: { platform?: { architecture?: string, os?: string }, annotations?: Record<string, string> }[] }} */
  const index = JSON.parse(rawManifestList);
  return (index.manifests ?? []).filter(
    (entry) =>
      entry.platform?.architecture === "unknown" &&
      entry.platform.os === "unknown" &&
      entry.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
  ).length;
}

/**
 * Attestations are written only after {@link assertArtifact} has passed, so a saved
 * attestation is always one this run also verified.
 *
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {string} outputRoot
 * @param {string | undefined} attestationRoot
 */
export function buildImage(image, version, outputRoot, attestationRoot) {
  const destination = join(outputRoot, image.name);
  runProcess(
    DOCKER,
    buildArgv(image, version, {
      tags: [`${image.name}:${imageTag(version)}`],
      output: `type=oci,dest=${destination},tar=false`,
    }),
  );
  assertArtifact(destination, version, image.name);
  const npmPackages = assertNoDevPackages(destination, image.name);
  process.stdout.write(
    `build-images: ${image.name} ${version} - SBOM, provenance and stamp present; ` +
      `${String(npmPackages)} npm packages, none dev-only\n`,
  );
  if (attestationRoot === undefined) return;
  for (const file of saveAttestations(destination, image.name, attestationRoot)) {
    process.stdout.write(`build-images: wrote ${file}\n`);
  }
}

/**
 * The pushed manifest is read back, because "the local copy had an SBOM" and "the
 * registry copy has one" are different claims and only the second is what a user pulls.
 *
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {string} namespace
 * @param {string[]} tags
 */
export function pushImage(image, version, namespace, tags) {
  const references = imageReferences(namespace, image.name, tags);
  runProcess(DOCKER, buildArgv(image, version, { tags: references, output: "type=registry" }));
  for (const reference of references) {
    const raw = captureProcess(DOCKER, ["buildx", "imagetools", "inspect", "--raw", reference]);
    if (attestationManifestCount(raw) === 0) {
      throw new Error(
        `build-images: ${reference} was pushed without an attestation manifest; the SBOM and provenance did not survive the export`,
      );
    }
    process.stdout.write(`build-images: pushed ${reference} with its attestations\n`);
  }
}

/**
 * Without this guard a missing value reads as `undefined` and `String()` turns it
 * into the literal "undefined", so `--output` would build into a directory of that
 * name and `--tag` would push that tag.
 *
 * @param {string[]} argv
 * @param {number} flagIndex
 * @param {string} flag
 * @param {string} example
 * @returns {string}
 */
function valueAfter(argv, flagIndex, flag, example) {
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`build-images: ${flag} needs a value, for example ${example}`);
  }
  return value;
}

/**
 * @param {string[]} argv
 * @returns {{ outputRoot: string, namespace: string | undefined, tags: string[],
 *   attestationRoot: string | undefined }}
 */
export function parseArgv(argv) {
  const outputIndex = argv.indexOf("--output");
  const pushIndex = argv.indexOf("--push");
  const attestationsIndex = argv.indexOf("--attestations");
  /** @type {string[]} */
  const tags = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") {
      tags.push(valueAfter(argv, index, "--tag", "--tag latest"));
    }
  }
  const namespace =
    pushIndex === -1
      ? undefined
      : valueAfter(argv, pushIndex, "--push", "--push roonga (a registry namespace)");
  const outputRoot =
    outputIndex === -1
      ? join(REPOSITORY_ROOT, "dist-images")
      : valueAfter(argv, outputIndex, "--output", "--output ./dist-images");
  const attestationRoot =
    attestationsIndex === -1
      ? undefined
      : valueAfter(argv, attestationsIndex, "--attestations", "--attestations ./dist-attestations");
  return { outputRoot, namespace, tags, attestationRoot };
}

export function main(argv = process.argv.slice(2)) {
  const { outputRoot, namespace, tags, attestationRoot } = parseArgv(argv);
  const version = imageVersion();
  process.stdout.write(`build-images: version ${version}\n`);
  ensureBuilder();
  for (const image of IMAGES) {
    if (!existsSync(join(REPOSITORY_ROOT, image.dockerfile))) {
      throw new Error(`build-images: ${image.dockerfile} is missing`);
    }
    buildImage(image, version, outputRoot, attestationRoot);
    if (namespace !== undefined) pushImage(image, version, namespace, tags);
  }
  process.stdout.write(
    `build-images: all ${String(IMAGES.length)} images built into ${outputRoot}` +
      (namespace === undefined
        ? "\n"
        : ` and published to ${REGISTRY}/${namespace} as ${tags.join(", ")}\n`),
  );
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
