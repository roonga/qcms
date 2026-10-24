import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  bumpFor,
  changesetFileName,
  main,
  manifestDependencyMoves,
  renderChangeset,
  templateManifestApp,
  templateManifestMoves,
} from "./dependabot-changeset.mjs";

import { parseChangesetPackages } from "./check-changeset.mjs";
import { diffTrees } from "../packages/create-qcms-app/scripts/sync-templates.mjs";

const manifest = (fields: Record<string, unknown>): string =>
  JSON.stringify({ name: "@roonga/qcms-db", version: "0.0.0", ...fields });

describe("manifestDependencyMoves", () => {
  it("reports a range that moved", () => {
    const before = manifest({ dependencies: { pg: "^8.22.0" } });
    const after = manifest({ dependencies: { pg: "^8.23.0" } });
    const { moves, otherFieldsChanged } = manifestDependencyMoves(before, after);
    expect(otherFieldsChanged).toBe(false);
    expect(moves).toStrictEqual([
      { field: "dependencies", name: "pg", from: "^8.22.0", to: "^8.23.0" },
    ]);
  });

  it("reports nothing when only key order differs", () => {
    const before = manifest({ dependencies: { pg: "^8.22.0", zod: "^4.0.0" } });
    const after = manifest({ dependencies: { zod: "^4.0.0", pg: "^8.22.0" } });
    expect(manifestDependencyMoves(before, after).moves).toStrictEqual([]);
  });

  it("flags a change outside the dependency blocks", () => {
    const before = manifest({ dependencies: { pg: "^8.22.0" }, files: ["dist"] });
    const after = manifest({ dependencies: { pg: "^8.23.0" }, files: ["dist", "README.md"] });
    expect(manifestDependencyMoves(before, after).otherFieldsChanged).toBe(true);
  });
});

describe("bumpFor", () => {
  it("takes a minor when the peer contract moves", () => {
    // A peer range tells a consumer's package manager which versions satisfy the ask,
    // so moving it can require action on their side.
    expect(bumpFor([{ field: "peerDependencies" }, { field: "devDependencies" }])).toBe("minor");
  });

  it("takes a patch for everything else", () => {
    expect(bumpFor([{ field: "dependencies" }, { field: "devDependencies" }])).toBe("patch");
  });
});

describe("changesetFileName", () => {
  it("derives a stable name from the branch, so a re-run rewrites its own file", () => {
    expect(changesetFileName("dependabot/npm_and_yarn/minor-and-patch-6dae55273e")).toBe(
      "dependabot-npm-and-yarn-minor-and-patch-6dae55273e.md",
    );
    expect(changesetFileName("dependabot/npm_and_yarn/minor-and-patch-6dae55273e")).toBe(
      changesetFileName("dependabot/npm_and_yarn/minor-and-patch-6dae55273e"),
    );
  });

  it("still produces a name for a branch with nothing usable in it", () => {
    expect(changesetFileName("///")).toBe("dependabot-deps.md");
  });
});

describe("renderChangeset", () => {
  const rendered = renderChangeset([
    {
      name: "@roonga/qcms-db",
      bump: "minor",
      moves: [
        {
          field: "peerDependencies",
          name: "testcontainers",
          from: "^12.0.4",
          to: "^12.1.0",
        },
        { field: "devDependencies", name: "@types/pg", from: "^8.20.3", to: "^8.23.1" },
      ],
    },
    {
      name: "@roonga/qcms-ui",
      bump: "patch",
      moves: [{ field: "devDependencies", name: "@types/react", from: "^19.2.18", to: "^19.2.19" }],
    },
  ]);

  it("is read back by the gate's own frontmatter parser", () => {
    expect(parseChangesetPackages(rendered)).toStrictEqual(["@roonga/qcms-db", "@roonga/qcms-ui"]);
  });

  it("separates what a consumer resolves from what it does not", () => {
    expect(rendered).toContain("Ranges a consumer resolves against:");
    expect(rendered).toContain("`testcontainers` ^12.0.4 to ^12.1.0 (peerDependencies)");
    expect(rendered).toContain("Development ranges, which reach no consumer:");
  });
});

const TEMPLATE_BEFORE = JSON.stringify(
  {
    name: "portal",
    private: true,
    dependencies: {
      "@opentelemetry/api": "^1.9.1",
      "@opentelemetry/sdk-trace-base": "^2.10.0",
      "@roonga/qcms-ui": "^0.0.0",
      next: "^16.3.3",
    },
    devDependencies: { "@types/react": "^19.2.18" },
  },
  null,
  2,
);

const TEMPLATE_AFTER = TEMPLATE_BEFORE.replace("^2.10.0", "^2.11.0").replace("^16.3.3", "^16.3.4");

const TEMPLATES = "packages/create-qcms-app/templates";
const PORTAL_TEMPLATE = `${TEMPLATES}/common/apps/portal/package.json`;
const ADMIN_TEMPLATE = `${TEMPLATES}/common/apps/admin/package.json`;

describe("templateManifestApp", () => {
  it("names the app a generated manifest belongs to", () => {
    expect(templateManifestApp(PORTAL_TEMPLATE)).toBe("portal");
  });

  it.each([
    // Generated, but not a manifest: a source file regenerating is not a dependency bump.
    `${TEMPLATES}/common/apps/portal/app/page.tsx`,
    // A manifest, but the canonical app the templates are derived from.
    "apps/portal/package.json",
    // Hand-written rather than generated from an app.
    "packages/create-qcms-app/templates-static/README.md",
  ])("does not claim %s", (path) => {
    expect(templateManifestApp(path)).toBeUndefined();
  });
});

describe("templateManifestMoves", () => {
  it("describes the fixture bump once, naming every app that carries it", () => {
    const { moves, refusal } = templateManifestMoves(
      [
        { path: PORTAL_TEMPLATE, before: TEMPLATE_BEFORE, after: TEMPLATE_AFTER },
        { path: ADMIN_TEMPLATE, before: TEMPLATE_BEFORE, after: TEMPLATE_AFTER },
      ],
      [],
    );

    expect(refusal).toBeUndefined();
    expect(moves).toStrictEqual([
      {
        field: "dependencies",
        name: "@opentelemetry/sdk-trace-base",
        from: "^2.10.0",
        to: "^2.11.0",
        scope: "apps/admin, apps/portal",
      },
      {
        field: "dependencies",
        name: "next",
        from: "^16.3.3",
        to: "^16.3.4",
        scope: "apps/admin, apps/portal",
      },
    ]);
  });

  it("says nothing about a manifest the regeneration left alone", () => {
    const unchanged = [{ path: PORTAL_TEMPLATE, before: TEMPLATE_BEFORE, after: TEMPLATE_BEFORE }];
    expect(templateManifestMoves(unchanged, []).moves).toStrictEqual([]);
  });

  it("refuses when the regeneration rewrote something that is not a generated manifest", () => {
    const { moves, refusal } = templateManifestMoves(
      [{ path: PORTAL_TEMPLATE, before: TEMPLATE_BEFORE, after: TEMPLATE_AFTER }],
      [`${TEMPLATES}/common/apps/portal/app/page.tsx`],
    );

    expect(moves).toStrictEqual([]);
    expect(refusal).toContain(`${TEMPLATES}/common/apps/portal/app/page.tsx`);
  });

  it("refuses a generated manifest whose non-dependency fields moved", () => {
    const renamed = TEMPLATE_AFTER.replace('"name": "portal"', '"name": "web"');
    const { refusal } = templateManifestMoves(
      [{ path: PORTAL_TEMPLATE, before: TEMPLATE_BEFORE, after: renamed }],
      [],
    );

    expect(refusal).toContain("outside its dependency blocks");
  });
});

describe("renderChangeset with template moves", () => {
  const rendered = renderChangeset([
    {
      name: "create-qcms-app",
      bump: "patch",
      moves: [],
      templateMoves: [
        {
          field: "dependencies",
          name: "next",
          from: "^16.3.3",
          to: "^16.3.4",
          scope: "apps/portal",
        },
      ],
    },
  ]);

  it("is read back by the gate's own frontmatter parser", () => {
    expect(parseChangesetPackages(rendered)).toStrictEqual(["create-qcms-app"]);
  });

  it("says where the range lives, since it is not a range this package resolves", () => {
    expect(rendered).toContain("`next` ^16.3.3 to ^16.3.4 (dependencies in apps/portal)");
    expect(rendered).toContain("app manifests this CLI stamps");
  });
});

const repos: string[] = [];

afterAll(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

function write(root: string, filePath: string, content: string): void {
  const absolute = join(root, filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function run(root: string, args: string[]): void {
  // `as string`: every call site passes a literal argv, so `args[0]` is never undefined
  // and a runtime guard would be unreachable.
  const result = spawnSync(args[0] as string, args.slice(1), { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed: ${result.stderr}`);
}

function commit(root: string, message: string): void {
  run(root, ["git", "add", "-A"]);
  const identity = ["-c", "user.email=gate@example.test", "-c", "user.name=Gate Test"];
  run(root, ["git", ...identity, "commit", "-q", "-m", message]);
}

function makeBumpedRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "dependabot-templates-"));
  repos.push(root);
  run(root, ["git", "init", "-q", "-b", "main"]);
  write(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "apps/*"\n');
  write(root, ".changeset/config.json", JSON.stringify({ ignore: [] }));
  write(
    root,
    "packages/db/package.json",
    JSON.stringify({ name: "@roonga/qcms-db", dependencies: { pg: "^8.22.0" } }),
  );
  write(root, "packages/create-qcms-app/package.json", JSON.stringify({ name: "create-qcms-app" }));
  write(root, "apps/portal/package.json", TEMPLATE_BEFORE);
  write(root, PORTAL_TEMPLATE, TEMPLATE_BEFORE);
  commit(root, "base");

  run(root, ["git", "checkout", "-q", "-b", "dependabot/npm_and_yarn/minor-and-patch-abc123"]);
  // What Dependabot's npm updater does, and all it does: it edits workspace members.
  write(root, "apps/portal/package.json", TEMPLATE_AFTER);
  write(
    root,
    "packages/db/package.json",
    JSON.stringify({ name: "@roonga/qcms-db", dependencies: { pg: "^8.23.0" } }),
  );
  commit(root, "chore(deps): bump the minor-and-patch group");
  return root;
}

describe("the one command a Dependabot bump needs (issue #834)", () => {
  it("regenerates the templates and names both packages in one changeset", async () => {
    const root = makeBumpedRepo();
    // Injected rather than generated, because the real generator reads this
    // repository's apps, not a fixture's.
    const generated = new Map([["common/apps/portal/package.json", TEMPLATE_AFTER]]);
    const onDisk = new Map([["common/apps/portal/package.json", TEMPLATE_BEFORE]]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Unset, or the helper names the file after this run's own `GITHUB_HEAD_REF` and
    // the assertion below passes locally while failing on CI.
    vi.stubEnv("GITHUB_HEAD_REF", undefined);

    const status = await main(["--write"], {
      cwd: root,
      templates: generated,
      current: onDisk,
      syncTemplates: () => {
        for (const [path, contents] of generated) write(root, `${TEMPLATES}/${path}`, contents);
      },
    });
    log.mockRestore();
    vi.unstubAllEnvs();

    expect(status).toBe(0);

    const written = readdirSync(join(root, ".changeset")).filter((name) =>
      name.startsWith("dependabot-"),
    );
    expect(written).toStrictEqual(["dependabot-npm-and-yarn-minor-and-patch-abc123.md"]);
    const body = readFileSync(join(root, ".changeset", written[0] as string), "utf8");

    expect(parseChangesetPackages(body)).toStrictEqual(["@roonga/qcms-db", "create-qcms-app"]);
    expect(body).toContain("`pg` ^8.22.0 to ^8.23.0 (dependencies)");
    expect(body).toContain("`next` ^16.3.3 to ^16.3.4 (dependencies in apps/portal)");

    const readBack = new Map(
      [...generated.keys()].map((path) => [
        path,
        readFileSync(join(root, TEMPLATES, path), "utf8"),
      ]),
    );
    expect(diffTrees(generated, readBack)).toStrictEqual([]);
  });

  it("names the changeset after GITHUB_HEAD_REF when a workflow checkout is detached", async () => {
    const root = makeBumpedRepo();
    run(root, ["git", "checkout", "-q", "--detach"]);
    const generated = new Map([["common/apps/portal/package.json", TEMPLATE_AFTER]]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("GITHUB_HEAD_REF", "dependabot/npm_and_yarn/grouped-99");

    const status = await main(["--write"], {
      cwd: root,
      templates: generated,
      current: generated,
      syncTemplates: () => undefined,
    });
    log.mockRestore();
    vi.unstubAllEnvs();

    expect(status).toBe(0);
    expect(
      readdirSync(join(root, ".changeset")).filter((name) => name.startsWith("dependabot-")),
    ).toStrictEqual(["dependabot-npm-and-yarn-grouped-99.md"]);
  });

  it("refuses when re-syncing would carry more than a dependency range into the scaffold", async () => {
    const root = makeBumpedRepo();
    const generated = new Map([
      ["common/apps/portal/package.json", TEMPLATE_AFTER],
      ["common/apps/portal/app/page.tsx", "export default function Page() {}\n"],
    ]);
    const onDisk = new Map([["common/apps/portal/package.json", TEMPLATE_BEFORE]]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const status = await main([], { cwd: root, templates: generated, current: onDisk });
    const said = error.mock.calls.flat().join("\n");
    error.mockRestore();

    expect(status).toBe(1);
    expect(said).toContain("common/apps/portal/app/page.tsx");
    expect(readdirSync(join(root, ".changeset"))).toStrictEqual(["config.json"]);
  });
});
