import { describe, expect, it } from "vitest";

import {
  BIN_OVERRIDE_ENV_VAR,
  ProgramNotFound,
  resolveGit,
  resolvePackageManager,
} from "./exec.js";

/** Every `QCMS_*` variable an error message tells the operator to set. */
function variablesNamedIn(message: string): string[] {
  return [...new Set(message.match(/QCMS_[A-Z_]+/g) ?? [])];
}

/**
 * The two programs, each paired with a resolver that takes an environment.
 *
 * The resolvers honour their override before touching the filesystem, so these run
 * the same way on a machine that has the program and one that does not.
 */
const PROGRAMS = [
  {
    label: "the package manager",
    variable: BIN_OVERRIDE_ENV_VAR.packageManager,
    resolve: (environment: NodeJS.ProcessEnv) => resolvePackageManager("pnpm", environment),
  },
  {
    label: "git",
    variable: BIN_OVERRIDE_ENV_VAR.git,
    resolve: (environment: NodeJS.ProcessEnv) => resolveGit(environment),
  },
] as const;

describe("the override variable a ProgramNotFound advertises", () => {
  // The bug this exists to prevent: the message derived `QCMS_PNPM_BIN` from the
  // program name while the resolver read `QCMS_PACKAGE_MANAGER_BIN`, so the remedy
  // the error offered did nothing and nothing was red. The check below never names a
  // variable itself: it reads one OUT of the message and hands it to the resolver, so
  // it can only pass if the two sides genuinely agree.
  it.each(PROGRAMS)("is the one $label actually reads", ({ variable, resolve }) => {
    const message = new ProgramNotFound("anything", ["/nowhere"], variable).message;
    const advertised = variablesNamedIn(message);
    expect(advertised).toHaveLength(1);

    const named = advertised[0] ?? "";
    expect(resolve({ [named]: "/opt/probe/binary" })).toStrictEqual({
      command: "/opt/probe/binary",
      leadingArguments: [],
    });
  });

  it.each(PROGRAMS)("names no other variable for $label", ({ variable }) => {
    const message = new ProgramNotFound("anything", ["/nowhere"], variable).message;
    expect(variablesNamedIn(message)).toStrictEqual([variable]);
  });

  it("keeps the two programs on different variables", () => {
    expect(BIN_OVERRIDE_ENV_VAR.packageManager).not.toBe(BIN_OVERRIDE_ENV_VAR.git);
  });

  it("still reports where it looked, so the message is diagnosable on its own", () => {
    const error = new ProgramNotFound("pnpm", ["/usr/bin/pnpm", "/bin/pnpm"], "QCMS_X_BIN");
    expect(error.message).toContain("/usr/bin/pnpm");
    expect(error.message).toContain("/bin/pnpm");
    expect(error.name).toBe("ProgramNotFound");
  });
});

describe("resolvePackageManager", () => {
  it("prefers the override over the interpreter that launched it", () => {
    const resolved = resolvePackageManager("pnpm", {
      [BIN_OVERRIDE_ENV_VAR.packageManager]: "/opt/probe/pnpm",
      npm_execpath: "/somewhere/pnpm.cjs",
    });
    expect(resolved.command).toBe("/opt/probe/pnpm");
  });

  it("ignores an empty override rather than spawning the empty string", () => {
    const resolved = resolvePackageManager("pnpm", {
      [BIN_OVERRIDE_ENV_VAR.packageManager]: "",
      npm_execpath: "/somewhere/pnpm.cjs",
    });
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.leadingArguments).toStrictEqual(["/somewhere/pnpm.cjs"]);
  });

  it("runs npm_execpath under this Node binary, never through a shell shim", () => {
    const resolved = resolvePackageManager("pnpm", { npm_execpath: "/somewhere/pnpm.cjs" });
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.command.startsWith("/")).toBe(true);
  });

  it("refuses npm_execpath when it does not name the chosen manager", () => {
    // The guard is a basename comparison, so what it must reject is an entry point
    // belonging to some other tool. `npm` was the natural counter-example until the
    // Code Owner's #449 ruling narrowed PACKAGE_MANAGERS to pnpm alone, so the case
    // is exercised with an npm entry point against the pnpm choice instead: same
    // mismatch, same branch, and it stays compilable if the list ever grows back.
    //
    // Which of the two legal outcomes happens depends on whether this machine has a
    // pnpm shim in one of the probed directories, so both are accepted and the
    // forbidden behaviour is what each asserts: never the foreign entry point.
    try {
      const resolved = resolvePackageManager("pnpm", { npm_execpath: "/somewhere/npm-cli.js" });
      expect(resolved.leadingArguments).toStrictEqual([]);
      expect(resolved.command).toContain("pnpm");
    } catch (error) {
      expect(error).toBeInstanceOf(ProgramNotFound);
      if (error instanceof ProgramNotFound) expect(error.message).not.toContain("npm-cli.js");
    }
  });
});
