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
 *
 * ## Publishing (issue #763)
 *
 * `--push <namespace>` adds a second buildx invocation per image that exports to
 * `type=registry` instead of an OCI directory, tagged `ghcr.io/<namespace>/<image>`
 * once per `--tag`. It runs only after the local artifact has passed
 * {@link assertArtifact}, so nothing reaches a registry that has not already been
 * proven to carry an SBOM, provenance and a real version stamp. The second
 * invocation is the same build definition with different tags, so BuildKit answers
 * it from the cache the first one just filled: it re-exports, it does not rebuild.
 *
 * The pushed manifest is then read back with `buildx imagetools inspect --raw` and
 * checked for an attestation manifest, because "the local copy had an SBOM" and "the
 * registry copy has one" are different claims and only the second one is what an
 * adopter pulls.
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

/**
 * The registry the images publish to (issue #763).
 *
 * GHCR and not Docker Hub: it is free for this repository, and a push authenticates
 * with the built-in `GITHUB_TOKEN` under `packages: write`, so publishing introduces
 * no credential anyone has to store or rotate. `.github/workflows/mirror-test-images.yml`
 * already pushes here on the same token.
 */
export const REGISTRY = "ghcr.io";

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
  // Whole-element equality, spelled out. `predicates` is an array, so `.includes()` was
  // already exact - but CodeQL reads it as `String.prototype.includes` and reports
  // js/incomplete-url-substring-sanitization, since these predicate types are URLs. The
  // explicit comparison says the same thing in a form no reader has to type-infer.
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
 * The buildx argument vector for one image, with the exporter and tags supplied.
 *
 * One function for both the local build and the push, so the two cannot drift on the
 * flags that decide what the artifact contains. Only `--tag` and `--output` differ:
 * neither is part of the build graph, so BuildKit serves the push from the cache the
 * local build filled rather than building the image a second time.
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
 * The registry references one image publishes under.
 *
 * A repository path must be lowercase, and a tag is `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}`.
 * Both are checked here rather than left to the registry, because a rejected push in
 * CI reads as an infrastructure failure and this reads as the mistake it is. The owner
 * arrives from `github.repository_owner`, which preserves the case a person typed.
 *
 * @param {string} namespace registry namespace, for example `roonga`.
 * @param {string} name image name, for example `qcms-api`.
 * @param {string[]} tags one or more tags to publish the same build under.
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
 * The attestation manifests in a raw manifest list, by the descriptor shape buildx
 * writes: an `unknown/unknown` platform plus the attestation reference type.
 *
 * @param {string} rawManifestList the JSON `buildx imagetools inspect --raw` prints.
 * @returns {number} how many attestation manifests the list carries.
 */
export function attestationManifestCount(rawManifestList) {
  /** @type {{ manifests?: { platform?: { architecture?: string }, annotations?: Record<string, string> }[] }} */
  const index = JSON.parse(rawManifestList);
  return (index.manifests ?? []).filter(
    (entry) =>
      entry.platform?.architecture === "unknown" ||
      entry.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
  ).length;
}

/**
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {string} outputRoot
 */
export function buildImage(image, version, outputRoot) {
  const destination = join(outputRoot, image.name);
  runProcess(
    DOCKER,
    buildArgv(image, version, {
      tags: [`${image.name}:${imageTag(version)}`],
      output: `type=oci,dest=${destination},tar=false`,
    }),
  );
  assertArtifact(destination, version, image.name);
  process.stdout.write(
    `build-images: ${image.name} ${version} - SBOM, provenance and stamp present\n`,
  );
}

/**
 * Publish one already-asserted image to the registry, then read the pushed manifest
 * back and require the attestations to have survived the export.
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
 * Read `--output`, `--push` and the repeatable `--tag` out of the argument vector.
 *
 * @param {string[]} argv
 * @returns {{ outputRoot: string, namespace: string | undefined, tags: string[] }}
 */
export function parseArgv(argv) {
  const outputIndex = argv.indexOf("--output");
  const pushIndex = argv.indexOf("--push");
  /** @type {string[]} */
  const tags = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag" && argv[index + 1] !== undefined)
      tags.push(String(argv[index + 1]));
  }
  const namespace = pushIndex === -1 ? undefined : argv[pushIndex + 1];
  if (pushIndex !== -1 && (namespace === undefined || namespace.startsWith("--"))) {
    throw new Error("build-images: --push needs a registry namespace, for example --push roonga");
  }
  const outputRoot =
    outputIndex === -1 ? join(REPOSITORY_ROOT, "dist-images") : String(argv[outputIndex + 1]);
  return { outputRoot, namespace, tags };
}

export function main(argv = process.argv.slice(2)) {
  const { outputRoot, namespace, tags } = parseArgv(argv);
  const version = imageVersion();
  process.stdout.write(`build-images: version ${version}\n`);
  ensureBuilder();
  for (const image of IMAGES) {
    if (!existsSync(join(REPOSITORY_ROOT, image.dockerfile))) {
      throw new Error(`build-images: ${image.dockerfile} is missing`);
    }
    buildImage(image, version, outputRoot);
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
