import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withDefaults, type DeploymentShape, type ScaffoldOptions } from "./options.js";
import { nextCommands } from "./next-steps.js";
import { scaffold, TargetNotEmpty } from "./scaffold.js";

function target(): string {
  return join(mkdtempSync(join(tmpdir(), "qcms-scaffold-")), "my-forms");
}

function stamp(overrides: Partial<ScaffoldOptions> = {}): {
  options: ScaffoldOptions;
  files: readonly string[];
  read: (relative: string) => string;
} {
  const options = withDefaults({ targetDirectory: target(), ...overrides }, "/tmp");
  const result = scaffold(options);
  return {
    options,
    files: result.files,
    read: (relative) => readFileSync(join(options.targetDirectory, ...relative.split("/")), "utf8"),
  };
}

describe("scaffold", () => {
  it("writes the three apps, the compose topology and the Dockerfiles", () => {
    const { files } = stamp();
    for (const path of [
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      "docker-compose.yml",
      "docker/api.Dockerfile",
      "docker/portal.Dockerfile",
      "docker/admin.Dockerfile",
      "apps/api/package.json",
      "apps/portal/package.json",
      "apps/admin/package.json",
      "README.md",
      ".env.example",
      ".env",
      ".gitignore",
      ".dockerignore",
      ".npmrc",
    ]) {
      expect(files).toContain(path);
    }
  });

  it("resolves both path conventions, leaving no _ or .tmpl in the output", () => {
    const { files } = stamp();
    expect(files.filter((path) => path.endsWith(".tmpl"))).toStrictEqual([]);
    expect(files.filter((path) => path.split("/").some((s) => s.startsWith("_")))).toStrictEqual(
      [],
    );
  });

  it("carries none of this repository's test or harness files", () => {
    const { files } = stamp();
    expect(files.filter((path) => /\.test\./.test(path))).toStrictEqual([]);
    expect(files.filter((path) => path.includes("/e2e/"))).toStrictEqual([]);
  });

  it("stamps the Caddy overlay for solo and withholds it for enterprise", () => {
    expect(stamp({ shape: "solo" }).files).toContain("docker-compose.proxy.yml");
    expect(stamp({ shape: "enterprise" }).files).not.toContain("docker-compose.proxy.yml");
  });

  it("names the project everywhere it has to agree", () => {
    const { read } = stamp({ projectName: "insurance-forms" });
    expect(JSON.parse(read("package.json"))).toMatchObject({ name: "insurance-forms" });
    expect(read("README.md")).toContain("# insurance-forms");
  });

  it("puts the answers into .env and generates the secrets nobody answered", () => {
    const { read } = stamp({
      portalBaseUrl: "https://forms.example.com",
      adminBaseUrl: "https://authoring.example.com",
      adminTwoFactor: "optional",
    });
    const env = read(".env");
    expect(env).toContain("QCMS_PORTAL_BASE_URL=https://forms.example.com");
    expect(env).toContain("QCMS_ADMIN_BASE_URL=https://authoring.example.com");
    expect(env).toContain("QCMS_ADMIN_2FA=optional");
    for (const secret of ["QCMS_LINK_KEYS", "QCMS_SESSION_KEYS", "QCMS_APP_KEY"]) {
      const value = new RegExp(`^${secret}=(.+)$`, "m").exec(env)?.[1] ?? "";
      expect(value.length).toBeGreaterThanOrEqual(32);
    }
  });

  it("leaves nothing unresolved in .env once the prompts are answered", () => {
    const options = withDefaults({ targetDirectory: target() }, "/tmp");
    expect(scaffold(options).unresolvedEnv).toStrictEqual([]);
  });

  it("gives every scaffolded app a real version range for every @qcms package", () => {
    const { read } = stamp();
    for (const app of ["api", "portal", "admin"]) {
      const manifest = JSON.parse(read(`apps/${app}/package.json`)) as {
        dependencies: Record<string, string>;
      };
      const qcms = Object.entries(manifest.dependencies).filter(([name]) =>
        name.startsWith("@roonga/qcms-"),
      );
      expect(qcms.length).toBeGreaterThan(0);
      for (const [, range] of qcms) expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    }
  });

  it("keeps the Dockerfiles free of the monorepo layout the scaffold does not have", () => {
    const { read } = stamp();
    for (const app of ["api", "portal", "admin"]) {
      const dockerfile = read(`docker/${app}.Dockerfile`);
      expect(dockerfile).not.toContain("COPY packages ./packages");
      expect(dockerfile).not.toContain("COPY scripts ./scripts");
      // The `...` suffix means "and every workspace dependency", which the scaffold
      // has none of. Asserted on the RUN line rather than on the whole file, because
      // the portal Dockerfile's prose legitimately quotes the old command.
      expect(dockerfile).not.toContain(`RUN pnpm --filter qcms-${app}... build`);
      expect(dockerfile).toContain(`RUN pnpm --filter qcms-${app} build`);
    }
  });

  it("forwards the admin 2FA policy to the two services that read it, exactly once each", () => {
    // The generator used to INSERT this; the canonical compose file now carries it, so
    // the generator asserts instead. Two, never four: a duplicate YAML key inside one
    // service block is resolved silently rather than reported.
    const { read } = stamp();
    const compose = read("docker-compose.yml");
    expect(compose.match(/QCMS_ADMIN_2FA: \$\{QCMS_ADMIN_2FA:-required\}/g)).toHaveLength(2);
  });

  it("stamps the adopter's project name into every image title, and QCMS's into none", () => {
    // Issue #457, tier 1. An image labelled as sourced from this repository points
    // anyone reading OCI labels at a repository that does not hold the code inside it.
    const { read } = stamp({ projectName: "insurance-forms" });
    for (const app of ["api", "portal", "admin"]) {
      const dockerfile = read(`docker/${app}.Dockerfile`);
      expect(dockerfile).toContain(`org.opencontainers.image.title="insurance-forms-${app}"`);
      expect(dockerfile).not.toContain("qcms/qcms");
      expect(dockerfile).not.toContain('org.opencontainers.image.source="https://github.com');
    }
  });

  it("names no QCMS repository script in anything the scaffolded apps print", () => {
    // Issue #457, tier 2: an admin screen told the operator to run `pnpm dev:seed` and
    // the bootstrap tool's own usage named `pnpm qcms:create-admin`, neither of which a
    // scaffolded project defines.
    // The message VALUES, not the comments: the comments around them are tier 3, and
    // `docs/ownership-seam.md` records the decision to leave those alone.
    const { read } = stamp();
    const catalog = read("apps/admin/lib/i18n/en.ts");
    const values = catalog.match(/^ {2}"[\w.]+":[\s\S]*?",$/gm) ?? [];
    expect(values.length).toBeGreaterThan(20);
    expect(values.join("\n")).not.toContain("pnpm ");
    const createAdmin = read("apps/api/src/create-admin.ts");
    const usage = createAdmin.slice(createAdmin.indexOf("async function main"));
    expect(usage).not.toContain("pnpm qcms:create-admin");
    expect(usage).toContain("node dist/create-admin.js");
  });

  it("refuses a directory that already holds files", () => {
    const directory = target();
    const options = withDefaults({ targetDirectory: directory }, "/tmp");
    scaffold(options);
    expect(readdirSync(directory).length).toBeGreaterThan(0);
    expect(() => scaffold(options)).toThrow(TargetNotEmpty);
  });

  it("stamps into an occupied directory when --force says so", () => {
    const directory = target();
    const options = withDefaults({ targetDirectory: directory, force: true }, "/tmp");
    scaffold(options);
    writeFileSync(join(directory, "NOTES.md"), "mine");
    expect(() => scaffold(options)).not.toThrow();
    expect(readFileSync(join(directory, "NOTES.md"), "utf8")).toBe("mine");
  });
});

describe("the closing message and the README", () => {
  it.each<DeploymentShape>(["solo", "enterprise"])(
    "prints only commands the %s README also carries",
    (shape) => {
      const { options, read } = stamp({ shape });
      const readme = read("README.md");
      for (const command of nextCommands(options).slice(1)) {
        expect(readme).toContain(command);
      }
    },
  );
});
