/**
 * The scaffolded prompt loop, driven exactly as an adopter runs it: through the scripts
 * the stamped `package.json` defines, in a stamped tree, with nothing from this workspace
 * on the resolution path except the formatter the manifest declares.
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { withDefaults } from "./options.js";
import { scaffold } from "./scaffold.js";

const RECIPE = "apps/api/src/features/agent/prompts/recipes/yes-or-no.md";
const GENERATED = "apps/api/src/features/agent/prompts/prompts.generated.ts";
const VERSION_FILE = "apps/api/src/features/agent/system-prompt.ts";

/** Each case stamps a tree and spawns the generator several times, on a loaded host. */
const TIMEOUT = 60_000;

/** Changes the prompt text and nothing a gate reads as a defect. */
const EDIT = "Say so plainly when neither answer fits.";

/** A scaffolded project that can resolve the formatter its manifest declares. */
function stamped(): string {
  const workspace = mkdtempSync(join(tmpdir(), "qcms-prompts-"));
  onTestFinished(() => {
    rmSync(workspace, { recursive: true, force: true });
  });
  const directory = join(workspace, "my-forms");
  scaffold(withDefaults({ targetDirectory: directory }, "/tmp"));

  // An adopter installs it; a test links the copy this workspace already has.
  const prettier = dirname(createRequire(import.meta.url).resolve("prettier/package.json"));
  mkdirSync(join(directory, "node_modules"), { recursive: true });
  symlinkSync(prettier, join(directory, "node_modules", "prettier"), "dir");
  return directory;
}

function read(directory: string, relative: string): string {
  return readFileSync(join(directory, ...relative.split("/")), "utf8");
}

function write(directory: string, relative: string, contents: string): void {
  writeFileSync(join(directory, ...relative.split("/")), contents);
}

/**
 * Run one of the stamped manifest's scripts, so the test exercises the wiring an adopter
 * types rather than a path it happens to know.
 */
function runScript(directory: string, name: string): SpawnSyncReturns<string> {
  const manifest = JSON.parse(read(directory, "package.json")) as {
    scripts: Record<string, string | undefined>;
  };
  const script = manifest.scripts[name];
  if (script === undefined) throw new Error(`The scaffolded package.json defines no "${name}".`);
  const [binary, ...args] = script.split(" ");
  expect(binary).toBe("node");
  return spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
}

/** The hash `--write` prints for the edited sources, recorded as an adopter records it. */
function recordHash(directory: string, output: string, version: number): void {
  const hash = /PROMPT_SOURCE_HASH = "([0-9a-f]{64})"/.exec(output)?.[1];
  expect(hash).toBeDefined();
  const current = read(directory, VERSION_FILE);
  write(
    directory,
    VERSION_FILE,
    current
      .replace(/PROMPT_SOURCE_HASH =\s*"[0-9a-f]{64}"/, `PROMPT_SOURCE_HASH =\n  "${hash ?? ""}"`)
      .replace(/SYSTEM_PROMPT_VERSION = \d+;/, `SYSTEM_PROMPT_VERSION = ${String(version)};`),
  );
}

function recordedVersion(directory: string): number {
  return Number(/SYSTEM_PROMPT_VERSION = (\d+);/.exec(read(directory, VERSION_FILE))?.[1]);
}

describe("the prompt generator a scaffolded project receives", () => {
  it("is in step with the prompt text the scaffold ships", () => {
    const directory = stamped();
    const check = runScript(directory, "check:prompts");
    expect(check.stdout).toContain("matches its Markdown");
    // A project under no version control is a supported case, not two lines of git noise.
    expect(check.stderr).not.toContain("fatal:");
    expect(check.status).toBe(0);
  }, TIMEOUT);

  it("rebuilds the generated module from an edited Markdown source", () => {
    const directory = stamped();
    expect(read(directory, GENERATED)).not.toContain(EDIT);

    write(directory, RECIPE, `${read(directory, RECIPE)}\n${EDIT}\n`);
    const generate = runScript(directory, "prompts:generate");
    expect(generate.stderr).toBe("");
    expect(generate.status).toBe(0);

    expect(read(directory, GENERATED)).toContain(EDIT);
  }, TIMEOUT);

  it("fails verify on a generated module left stale, and passes once it is rebuilt", () => {
    const directory = stamped();
    const manifest = JSON.parse(read(directory, "package.json")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["verify"]).toContain("pnpm check:prompts");

    write(directory, RECIPE, `${read(directory, RECIPE)}\n${EDIT}\n`);
    const stale = runScript(directory, "check:prompts");
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain(`${GENERATED} is stale`);

    const generate = runScript(directory, "prompts:generate");
    expect(generate.status).toBe(0);
    recordHash(directory, generate.stdout, recordedVersion(directory) + 1);

    const rebuilt = runScript(directory, "check:prompts");
    expect(rebuilt.stdout).toContain("matches its Markdown");
    expect(rebuilt.status).toBe(0);
  }, TIMEOUT);

  it("holds an adopter under version control to a prompt version bump", () => {
    const directory = stamped();
    const git = (...args: string[]): void => {
      execFileSync("git", ["-c", "user.name=QCMS", "-c", "user.email=scaffold@qcms.test", ...args], {
        cwd: directory,
        stdio: "ignore",
      });
    };
    git("init", "-b", "main");
    git("add", "-A");
    git("commit", "-m", "scaffold");

    write(directory, RECIPE, `${read(directory, RECIPE)}\n${EDIT}\n`);
    const generate = runScript(directory, "prompts:generate");
    expect(generate.status).toBe(0);

    const version = recordedVersion(directory);
    recordHash(directory, generate.stdout, version);
    const unbumped = runScript(directory, "check:prompts");
    expect(unbumped.status).toBe(1);
    expect(unbumped.stderr).toContain(`SYSTEM_PROMPT_VERSION is still ${String(version)}`);

    recordHash(directory, generate.stdout, version + 1);
    expect(runScript(directory, "check:prompts").status).toBe(0);
  }, TIMEOUT);
});
