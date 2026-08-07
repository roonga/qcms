/**
 * Build the three QCMS images with a real version stamp and an SBOM (task 036).
 *
 * ## The two problems this solves
 *
 * 1. **Every image claimed to be `dev`.** All three Dockerfiles declare
 *    `ARG VERSION=dev` and stamp it into `org.opencontainers.image.version`, and
 *    nothing ever passed a value, so the label was present, well-formed and useless.
 *    A label that is always the same string cannot tell two builds apart, which is
 *    the entire reason to have it during an incident.
 * 2. **No SBOM.** "What is in this image" is a question an adopter's security review
 *    asks, and answering it by hand from a lockfile is a worse answer than the one
 *    buildx will generate.
 *
 * ## Why buildx and no new dependency
 *
 * `docker buildx build --sbom=true --provenance=mode=max` produces both attestations
 * natively. It needs the docker-container driver (the default `docker` driver cannot
 * attach attestations), which is why {@link ensureBuilder} exists. The SBOM step
 * pulls `docker/buildkit-syft-scanner`, so a CI job running this must not assert
 * against Docker Hub pulls.
 *
 * ## The output layout, and why `tar=false`
 *
 * `--output type=oci,dest=<dir>,tar=false` writes a plain OCI **directory**: an
 * `index.json`, a `blobs/sha256/` tree, and nothing that needs a tar reader in Node
 * to inspect. The assertions below walk it directly:
 *
 * - `index.json` points at a manifest list.
 * - The entry whose `platform.architecture` is `unknown` is the **attestation**
 *   manifest. Its layers are `application/vnd.in-toto+json`, annotated with
 *   `in-toto.io/predicate-type`: `https://spdx.dev/Document` for the SBOM and
 *   `https://slsa.dev/provenance/v1` for the provenance.
 * - The other entry is the image proper; its config blob carries `.config.Labels`,
 *   which is where the version stamp has to show up.
 *
 * That traversal is the whole verification: it checks the artifact an adopter would
 * actually receive, rather than checking that we passed the right flags.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { captureProcess, DOCKER, REPOSITORY_ROOT, runProcess } from "./docker.mjs";

/** The three published images, and the Dockerfile each is built from. */
export const IMAGES = [
  { name: "qcms-api", dockerfile: "docker/api.Dockerfile" },
  { name: "qcms-portal", dockerfile: "docker/portal.Dockerfile" },
  { name: "qcms-admin", dockerfile: "docker/admin.Dockerfile" },
];

/** The buildx builder this script creates on demand; the default driver cannot attest. */
const BUILDER = "qcms-sbom";

export const SPDX_PREDICATE = "https://spdx.dev/Document";
export const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
export const VERSION_LABEL = "org.opencontainers.image.version";

/**
 * The version to stamp: the workspace version plus the short commit it was built from.
 *
 * Both halves earn their place. The package version alone repeats across every build
 * between two releases, which is the `dev` problem with extra steps; the SHA alone
 * does not say which release line a container belongs to. A dirty working tree is
 * marked, because an image built from uncommitted code is not reproducible and the
 * label is the only place that fact can survive into production.
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
 * The same version, made legal as a Docker tag.
 *
 * `0.0.1-alpha.0+83fa947` is correct SemVer (`+` introduces build metadata) and an
 * illegal image reference: a tag is `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}`, with no `+`.
 * The label keeps the true version, because that is the field an adopter reads to
 * identify a build; only the tag is rewritten, and `+` becomes `-` rather than being
 * dropped so the SHA stays visible in `docker images`.
 *
 * @param {string} version
 * @returns {string}
 */
export function imageTag(version) {
  return version.replaceAll("+", "-");
}

/** Create the docker-container builder if it is not already there. */
export function ensureBuilder() {
  const existing = captureProcess(DOCKER, ["buildx", "ls", "--format", "{{.Name}}"]);
  if (existing.split("\n").includes(BUILDER)) return;
  runProcess(DOCKER, ["buildx", "create", "--name", BUILDER, "--driver", "docker-container"]);
}

/**
 * Read an OCI directory layout and return the descriptors that matter.
 *
 * @param {string} directory
 * @returns {{ labels: Record<string, string>, predicates: string[] }}
 */
export function inspectOciArtifact(directory) {
  /** @param {string} digest */
  const blob = (digest) =>
    JSON.parse(
      readFileSync(join(directory, "blobs", "sha256", digest.replace("sha256:", "")), "utf8"),
    );

  const index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
  const manifestList = blob(index.manifests[0].digest);

  /** @type {string[]} */
  const predicates = [];
  /** @type {Record<string, string>} */
  let labels = {};

  for (const entry of manifestList.manifests) {
    const manifest = blob(entry.digest);
    if (entry.platform?.architecture === "unknown") {
      // The attestation manifest: one in-toto layer per predicate.
      for (const layer of manifest.layers ?? []) {
        const predicate = layer.annotations?.["in-toto.io/predicate-type"];
        if (predicate !== undefined) predicates.push(predicate);
      }
      continue;
    }
    labels = blob(manifest.config.digest).config?.Labels ?? {};
  }
  return { labels, predicates };
}

/**
 * Assert the artifact carries an SBOM, provenance, and the expected version stamp.
 *
 * @param {string} directory
 * @param {string} version
 * @param {string} name
 */
export function assertArtifact(directory, version, name) {
  const { labels, predicates } = inspectOciArtifact(directory);
  const problems = [];
  if (!predicates.includes(SPDX_PREDICATE)) problems.push(`no SBOM (${SPDX_PREDICATE})`);
  if (!predicates.includes(PROVENANCE_PREDICATE)) {
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
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {string} outputRoot
 */
export function buildImage(image, version, outputRoot) {
  const destination = join(outputRoot, image.name);
  runProcess(DOCKER, [
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
    "--tag",
    `${image.name}:${imageTag(version)}`,
    "--output",
    `type=oci,dest=${destination},tar=false`,
    ".",
  ]);
  assertArtifact(destination, version, image.name);
  process.stdout.write(
    `build-images: ${image.name} ${version} - SBOM, provenance and stamp present\n`,
  );
}

export function main(argv = process.argv.slice(2)) {
  const outputIndex = argv.indexOf("--output");
  const outputRoot =
    outputIndex === -1 ? join(REPOSITORY_ROOT, "dist-images") : argv[outputIndex + 1];
  const version = imageVersion();
  process.stdout.write(`build-images: version ${version}\n`);
  ensureBuilder();
  for (const image of IMAGES) {
    if (!existsSync(join(REPOSITORY_ROOT, image.dockerfile))) {
      throw new Error(`build-images: ${image.dockerfile} is missing`);
    }
    buildImage(image, version, outputRoot);
  }
  process.stdout.write(
    `build-images: all ${String(IMAGES.length)} images built into ${outputRoot}\n`,
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
