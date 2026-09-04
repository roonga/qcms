import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appManifest,
  assertComposeForwardsTwoFactor,
  assertComposeReferences,
  assertImports,
  assertNoEscapingPaths,
  assertReadmeClaims,
  assertReleaseAgeHoldIsStamped,
  rewriteDependencies,
  buildTemplates,
  diffTrees,
  isExcludedAppPath,
  outputName,
  publishedVersions,
  renderEnvExample,
  templateName,
  transformDockerfile,
  walk,
} from "./sync-templates.mjs";
import { templateFiles } from "../src/templates.js";

describe("the strip rules", () => {
  it.each([
    "src/app.test.ts",
    "components/kit.test.tsx",
    "src/test-support.ts",
    "vitest.config.ts",
    "vitest.setup.ts",
    "playwright.config.ts",
    "CONTRIBUTING.md",
    "README.md",
    "src/features/forms/README.md",
    ".env.example",
    "scripts/seed-fixtures.ts",
  ])("drops %j", (path) => {
    expect(isExcludedAppPath(path)).toBe(true);
  });

  it.each(["src/app.ts", "components/kit.tsx", "app/globals.css", ".gitignore", "tsconfig.json"])(
    "keeps %j",
    (path) => {
      expect(isExcludedAppPath(path)).toBe(false);
    },
  );
});

describe("the dot-file convention", () => {
  it.each([
    [".gitignore", "_gitignore"],
    ["apps/portal/.gitignore", "apps/portal/_gitignore"],
    ["docker/api.Dockerfile.tmpl", "docker/api.Dockerfile.tmpl"],
  ])("maps %j to %j and back", (output, template) => {
    expect(templateName(output)).toBe(template);
    expect(outputName(template)).toBe(output);
  });
});

describe("transformDockerfile", () => {
  const SOURCE = [
    "COPY package.json ./",
    "COPY apps ./apps",
    "COPY packages ./packages",
    "# Why tooling has to be here, in prose that explains the line below.",
    "COPY scripts ./scripts",
    "COPY tooling ./tooling",
    "RUN pnpm --filter qcms-api... build",
    'LABEL org.opencontainers.image.title="qcms-api" \\',
    '      org.opencontainers.image.version="${VERSION}" \\',
    '      org.opencontainers.image.source="https://github.com/roonga/qcms"',
  ].join("\n");

  it("drops every COPY line naming a directory the scaffold has not got", () => {
    const result = transformDockerfile(SOURCE, "qcms-api", "api");
    expect(result).not.toContain("COPY packages ./packages");
    expect(result).not.toContain("COPY scripts ./scripts");
    expect(result).not.toContain("COPY tooling ./tooling");
    expect(result).toContain("COPY apps ./apps");
  });

  it("takes the comment block that explains a dropped line with it", () => {
    // Otherwise the adopter reads a paragraph about a line that is not there.
    expect(transformDockerfile(SOURCE, "qcms-api", "api")).not.toContain("in prose that explains");
  });

  it("throws when a declared monorepo-only COPY is no longer present", () => {
    // The defect this replaces was a filter on two exact string literals: a renamed or
    // rewhitespaced line made it a silent no-op, and the adopter's image then failed on
    // a COPY of a directory the scaffold has not got (issue #456, blind spot C).
    const withoutTooling = SOURCE.split("\n")
      .filter((line) => line !== "COPY tooling ./tooling")
      .join("\n");
    expect(() => transformDockerfile(withoutTooling, "qcms-api", "api")).toThrow(
      /no longer copies/,
    );
  });

  it("throws when a COPY names a root directory nobody has classified", () => {
    const withNewDirectory = SOURCE.replace(
      "COPY apps ./apps",
      "COPY apps ./apps\nCOPY fixtures ./fixtures",
    );
    expect(() => transformDockerfile(withNewDirectory, "qcms-api", "api")).toThrow(
      /copies "fixtures"/,
    );
  });

  it("rewrites the workspace-dependency build into a plain one", () => {
    expect(transformDockerfile(SOURCE, "qcms-api", "api")).toContain(
      "RUN pnpm --filter qcms-api build",
    );
  });

  it("stamps the adopter's image title and drops the source label", () => {
    // A scaffolded image must not claim to come from this repository: the code inside
    // it is the adopter's (issue #457, tier 1).
    const result = transformDockerfile(SOURCE, "qcms-api", "api");
    expect(result).toContain('org.opencontainers.image.title="{{projectName}}-api"');
    expect(result).not.toContain("github.com/roonga/qcms");
    expect(result).toContain('org.opencontainers.image.version="${VERSION}"');
  });

  it("throws rather than silently doing nothing when the build anchor is gone", () => {
    expect(() => transformDockerfile("FROM node:24", "qcms-api", "api")).toThrow(
      /no longer contains/,
    );
  });

  it("throws rather than silently leaving QCMS's identity when the labels move", () => {
    const withoutLabels = SOURCE.split("\n")
      .filter((line) => !line.includes("org.opencontainers"))
      .join("\n");
    expect(() => transformDockerfile(withoutLabels, "qcms-api", "api")).toThrow(/OCI title/);
  });
});

describe("assertComposeForwardsTwoFactor", () => {
  const PASSTHROUGH = "QCMS_ADMIN_2FA: ${QCMS_ADMIN_2FA:-required}";
  const SOURCE = [
    "services:",
    "  api:",
    "    environment:",
    `      ${PASSTHROUGH}`,
    "  admin:",
    "    environment:",
    `      ${PASSTHROUGH}`,
    "volumes:",
    "  data:",
  ].join("\n");

  it("passes the canonical shape through unchanged", () => {
    expect(assertComposeForwardsTwoFactor(SOURCE)).toBe(SOURCE);
  });

  it("throws when a service that reads the policy stops being given it", () => {
    // The CLI prompts for the policy and writes it to .env. Without the passthrough the
    // adopter's answer reaches nothing, silently.
    const withoutAdmin = SOURCE.replace(
      `  admin:\n    environment:\n      ${PASSTHROUGH}`,
      "  admin:",
    );
    expect(() => assertComposeForwardsTwoFactor(withoutAdmin)).toThrow(/no longer forwards/);
  });

  it("throws on a duplicate, which a YAML reader resolves silently", () => {
    // This is the state the generator itself produced once `main` added the
    // passthrough that the old transform 5 was inserting.
    const duplicated = SOURCE.replace(
      `  api:\n    environment:\n      ${PASSTHROUGH}`,
      `  api:\n    environment:\n      ${PASSTHROUGH}\n      ${PASSTHROUGH}`,
    );
    expect(() => assertComposeForwardsTwoFactor(duplicated)).toThrow(/copies of/);
  });
});

describe("renderEnvExample", () => {
  const BASE = { text: "x: ${QCMS_APP_KEY:?set it}\ny: ${QCMS_DB_NAME:-qcms}", alwaysRuns: true };
  const OVERLAY = { text: "z: ${QCMS_ACME_EMAIL:?set it}", alwaysRuns: false };

  it("writes a base-topology mandatory variable uncommented", () => {
    expect(renderEnvExample([BASE])).toMatch(/^QCMS_APP_KEY=$/m);
  });

  it("writes an optional variable commented out", () => {
    expect(renderEnvExample([BASE])).toMatch(/^# QCMS_DB_NAME=$/m);
  });

  it("leaves an overlay's mandatory variable commented, since the overlay is optional", () => {
    const rendered = renderEnvExample([BASE, OVERLAY]);
    expect(rendered).toContain("QCMS_ACME_EMAIL");
    expect(rendered).toMatch(/^# QCMS_ACME_EMAIL=$/m);
  });

  it("marks key material, which is what tells the CLI it may generate a value", () => {
    expect(renderEnvExample([BASE])).toContain("# (required, secret)");
  });

  it("refuses a variable the configuration schema does not document", () => {
    expect(() => renderEnvExample([{ text: "a: ${QCMS_INVENTED:?x}", alwaysRuns: true }])).toThrow(
      /QCMS_INVENTED/,
    );
  });

  it("skips the values Compose supplies to itself", () => {
    const rendered = renderEnvExample([
      { text: "a: ${POSTGRES_USER}\nb: ${QCMS_APP_KEY:?x}", alwaysRuns: true },
    ]);
    expect(rendered).not.toContain("POSTGRES_USER");
  });
});

describe("appManifest", () => {
  const versions = publishedVersions();

  it.each(["api", "portal", "admin"] as const)(
    "gives %s registry ranges, not workspace links",
    (app) => {
      const manifest = appManifest(app, versions) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      const all = { ...manifest.dependencies, ...manifest.devDependencies };
      expect(Object.values(all)).not.toContain("workspace:*");
      for (const [name, range] of Object.entries(all)) {
        if (name.startsWith("@qcms/")) expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
      }
    },
  );

  it("keeps no script that needs this repository's runners", () => {
    for (const app of ["api", "portal", "admin"] as const) {
      const manifest = appManifest(app, versions) as { scripts: Record<string, string> };
      expect(Object.keys(manifest.scripts)).not.toContain("test");
      expect(Object.keys(manifest.scripts)).not.toContain("lint");
    }
  });

  it("drops the harness devDependencies", () => {
    const api = appManifest("api", versions) as { devDependencies: Record<string, string> };
    expect(api.devDependencies).not.toHaveProperty("@testcontainers/postgresql");
    expect(api.devDependencies).toHaveProperty("@types/node");
  });
});

describe("assertImports", () => {
  it("refuses a scaffolded file importing a package its app does not declare", () => {
    const tree = new Map(buildTemplates());
    tree.set("common/apps/portal/lib/rogue.ts", 'import { x } from "@qcms/db";');
    expect(() => assertImports(tree)).toThrow(/@qcms\/db, which apps\/portal does not declare/);
  });

  it("passes on the tree the generator actually produces", () => {
    expect(() => assertImports(buildTemplates())).not.toThrow();
  });
});

describe("the drift gate", () => {
  it("says nothing when the committed tree matches", () => {
    const generated = buildTemplates();
    expect(diffTrees(generated, new Map(generated))).toStrictEqual([]);
  });

  it("reports a template whose canonical source changed", () => {
    const generated = buildTemplates();
    const committed = new Map(generated);
    committed.set("common/apps/api/src/app.ts", "// an edit nobody regenerated");
    expect(diffTrees(generated, committed)).toStrictEqual([
      "drifted:  packages/create-qcms-app/templates/common/apps/api/src/app.ts",
    ]);
  });

  it("reports a template that was never generated", () => {
    const generated = buildTemplates();
    const committed = new Map(generated);
    committed.delete("common/apps/api/src/app.ts");
    expect(diffTrees(generated, committed)).toStrictEqual([
      "missing:  packages/create-qcms-app/templates/common/apps/api/src/app.ts",
    ]);
  });

  it("reports a template left behind after its source was deleted", () => {
    const generated = buildTemplates();
    const committed = new Map(generated);
    committed.set("common/apps/api/src/removed.ts", "// stale");
    expect(diffTrees(generated, committed)).toStrictEqual([
      "stale:    packages/create-qcms-app/templates/common/apps/api/src/removed.ts",
    ]);
  });
});

describe("reading a generated tree (issue #450)", () => {
  // The gate compares the COMMITTED template tree against a regenerated one, and it
  // used to read the committed side through a walk that skipped `dist`, `e2e`,
  // `coverage`, `.next` and six other directory names. That list is right for reading
  // `apps/`, which is what it was written for, and wrong for reading a tree that is
  // supposed to be compared exhaustively: the CLI's own stamping walk skips nothing, so
  // a file committed at `templates/common/apps/api/dist/leak.js` was stamped into every
  // scaffolded project while being invisible to `pnpm check:templates`.
  //
  // The fixture is a temporary tree rather than a committed file, because committing
  // one is the thing the gate exists to catch.
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "qcms-walk-"));
    for (const relative of [
      "common/apps/api/src/app.ts",
      "common/apps/api/dist/leak.js",
      "common/apps/api/e2e/harness.ts",
      "common/apps/api/coverage/index.html",
      "common/apps/portal/.next/build-manifest.json",
      "common/apps/portal/__snapshots__/x.snap",
      "solo/docker-compose.proxy.yml",
    ]) {
      const absolute = join(root, ...relative.split("/"));
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, "// fixture");
    }
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("sees a file under every directory name the old skip list hid", () => {
    expect(walk("common", root)).toStrictEqual([
      "common/apps/api/coverage/index.html",
      "common/apps/api/dist/leak.js",
      "common/apps/api/e2e/harness.ts",
      "common/apps/api/src/app.ts",
      "common/apps/portal/.next/build-manifest.json",
      "common/apps/portal/__snapshots__/x.snap",
    ]);
  });

  it("reports such a file as stale rather than staying green", () => {
    // The whole point: the generator would never produce `dist/leak.js`, so once the
    // walk can see it the diff has to call it out.
    const committed = new Map(walk("common", root).map((path) => [path, "// fixture"]));
    const generated = new Map([["common/apps/api/src/app.ts", "// fixture"]]);
    expect(diffTrees(generated, committed)).toContain(
      "stale:    packages/create-qcms-app/templates/common/apps/api/dist/leak.js",
    );
  });

  it("agrees with the walk the CLI stamps through, which is the asymmetry that was the bug", () => {
    const stamped = [...templateFiles("solo", root).keys()].sort();
    const scanned = [...walk("common", root), ...walk("solo", root)]
      .map((path) => path.slice(path.indexOf("/") + 1))
      .sort();
    expect(stamped).toStrictEqual(scanned);
  });
});

describe("the guards, proved red rather than merely green (issue #456)", () => {
  // Every one of these was a blind spot: a guard whose docstring claimed more than its
  // code did. A guard that has never been seen to fail is a guard nobody has tested,
  // which is the shape of defect this branch has now met three times.
  const tree = buildTemplates();

  /** The tree with one file replaced, so each case perturbs exactly one thing. */
  function withFile(path: string, contents: string): Map<string, string> {
    const copy = new Map(tree);
    copy.set(path, contents);
    return copy;
  }

  /** The tree with one substitution inside a file it already has. */
  function edited(path: string, from: string, to: string): Map<string, string> {
    const before = tree.get(path) ?? "";
    expect(before).toContain(from);
    return withFile(path, before.replace(from, to));
  }

  it("catches a Compose file whose build points at a Dockerfile nobody stamps", () => {
    // Blind spot B: the docker assets were enumerated by name, so a Compose file could
    // reference something the generator had never heard of and the gate stayed green
    // because the generated tree did not have it either.
    const drifted = edited(
      "common/docker-compose.yml",
      "dockerfile: docker/api.Dockerfile",
      "dockerfile: docker/absent.Dockerfile",
    );
    expect(() => assertComposeReferences(drifted)).toThrow(/docker\/absent\.Dockerfile/);
  });

  it("catches an overlay bind-mounting a host path nobody stamps", () => {
    const drifted = edited(
      "solo/docker-compose.proxy.yml",
      "./docker/Caddyfile:",
      "./docker/Absent:",
    );
    expect(() => assertComposeReferences(drifted)).toThrow(/docker\/Absent/);
  });

  it("catches a README naming a service the Compose file does not define", () => {
    // Blind spot G: `templates-static/` had nothing comparing it to anything.
    const drifted = edited(
      "solo/README.md.tmpl",
      "docker compose run --rm migrate",
      "docker compose run --rm migrator",
    );
    expect(() => assertReadmeClaims(drifted)).toThrow(/"migrator" service/);
  });

  it("catches a README naming a variable nothing reads", () => {
    const drifted = withFile(
      "solo/README.md.tmpl",
      `${tree.get("solo/README.md.tmpl") ?? ""}\nSet QCMS_INVENTED_KNOB in .env.\n`,
    );
    expect(() => assertReadmeClaims(drifted)).toThrow(/QCMS_INVENTED_KNOB/);
  });

  it("catches a NEW KIND of reach out of the project, not just a new instance", () => {
    // Blind spots D and E together, in the issue's own example. The predecessor shared
    // one regex with the transform it guarded and scanned `common/apps/` alone, so a
    // `paths` block in tsconfig.base.json pointing at `../../packages/*` was invisible
    // twice over: wrong file, wrong kind.
    const drifted = withFile(
      "common/tsconfig.base.json",
      '{ "compilerOptions": { "paths": { "@qcms/core": ["../../packages/core/src"] } } }',
    );
    expect(() => assertNoEscapingPaths(drifted)).toThrow(/climbs past the project root/);
  });

  it("catches a reach that lands on the project root but names nothing stamped there", () => {
    const drifted = withFile(
      "common/apps/api/src/app.ts",
      'import { x } from "../../../scripts/clean-dist.mjs";',
    );
    expect(() => assertNoEscapingPaths(drifted)).toThrow(/does not stamp/);
  });

  it("leaves a legitimate reach to the project root alone", () => {
    // `apps/<app>/next.config.ts` resolving `../../` is the workspace root, and a
    // scaffold has one at exactly that depth. A guard that fired here would be turned
    // off within a week.
    expect(() => assertNoEscapingPaths(tree)).not.toThrow();
  });

  it("catches a workspace dependency an adopter could not install", () => {
    // Blind spot F, and the one that turned out not to be latent at all: two private
    // packages became runtime dependencies of all three apps while this branch waited.
    // The old `??` fallback stamped an unknown `workspace:*` verbatim into the
    // adopter's manifest, where no registry can satisfy it. The message has to name
    // the package, or the next person reads a resolution error in someone else's
    // project instead of a generator error in ours.
    expect(() => rewriteDependencies({ "@qcms/unpublished": "workspace:*" }, {}, false)).toThrow(
      /@qcms\/unpublished/,
    );
    // A published one still resolves, so the guard is about the unknown case only.
    expect(
      rewriteDependencies({ hono: "^4.0.0" }, { "@qcms/core": "^1.0.0" }, false),
    ).toStrictEqual({ hono: "^4.0.0" });
  });
});

describe("the release-age hold the scaffold inherits (SEC-11)", () => {
  const tree = buildTemplates();

  it("is stamped into the scaffolded workspace, with both keys", () => {
    // One key without the other is a policy nothing enforces: pnpm only defaults the
    // strict flag on when the age is explicitly configured. Asserted on the generated
    // file rather than on the static one, because the generated file is what ships.
    const stamped = tree.get("common/pnpm-workspace.yaml") ?? "";
    expect(stamped).toMatch(/^minimumReleaseAge: \d+$/m);
    expect(stamped).toMatch(/^minimumReleaseAgeStrict: true$/m);
    expect(() => assertReleaseAgeHoldIsStamped(tree)).not.toThrow();
  });

  it("catches a scaffold that quietly loses the hold", () => {
    // The drift this exists for: two hand-maintained files holding one security
    // posture, and someone edits the repository's own without the scaffold's.
    const without = new Map(tree);
    without.set(
      "common/pnpm-workspace.yaml",
      (tree.get("common/pnpm-workspace.yaml") ?? "").replace(/^minimumReleaseAgeStrict:.*$/m, ""),
    );
    expect(() => assertReleaseAgeHoldIsStamped(without)).toThrow(/minimumReleaseAgeStrict/);
  });
});
