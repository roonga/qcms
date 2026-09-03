import { describe, expect, it } from "vitest";

import {
  BIN_OVERRIDE_ENV_VAR,
  InvalidBinOverride,
  ProgramNotFound,
  overrideProgram,
  resolveGit,
  resolvePackageManager,
} from "./exec.js";

/**
 * An absolute path to a real executable, on any machine that can run this test.
 *
 * The overrides are checked now (issue #458), so a made-up path is no longer a usable
 * fixture: it is one of the two things the check exists to refuse.
 */
const REAL_BINARY = process.execPath;

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
    expect(resolve({ [named]: REAL_BINARY })).toStrictEqual({
      command: REAL_BINARY,
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
      [BIN_OVERRIDE_ENV_VAR.packageManager]: REAL_BINARY,
      npm_execpath: "/somewhere/pnpm.cjs",
    });
    expect(resolved.command).toBe(REAL_BINARY);
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

describe("a checked binary-path override (issue #458)", () => {
  // The module header claims that no subprocess here is ever resolved through PATH.
  // Returning the override unchecked broke that claim in the one place lint cannot
  // see, because the value is a variable rather than a literal and
  // `sonarjs/no-os-command-from-path` only reads literals.
  it.each(PROGRAMS)(
    "refuses a bare name for $label, which PATH would resolve",
    ({ variable, resolve }) => {
      expect(() => resolve({ [variable]: "pnpm" })).toThrow(InvalidBinOverride);
      expect(() => resolve({ [variable]: "git" })).toThrow(/absolute path/);
    },
  );

  it.each(PROGRAMS)("refuses a relative path for $label", ({ variable, resolve }) => {
    expect(() => resolve({ [variable]: "./bin/pnpm" })).toThrow(/absolute path/);
    expect(() => resolve({ [variable]: "../bin/pnpm" })).toThrow(/absolute path/);
  });

  it.each(PROGRAMS)(
    "refuses an absolute path that is not there, naming both, for $label",
    ({ variable, resolve }) => {
      // The commoner mistake by far, and it used to surface as a bare ENOENT from
      // spawnSync naming neither the variable nor the value.
      let thrown: unknown;
      try {
        resolve({ [variable]: "/opt/probe/definitely-not-here" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(InvalidBinOverride);
      expect((thrown as Error).message).toContain(variable);
      expect((thrown as Error).message).toContain("/opt/probe/definitely-not-here");
    },
  );

  it("accepts an absolute path to something that exists, and passes it through whole", () => {
    expect(overrideProgram("QCMS_X_BIN", REAL_BINARY)).toStrictEqual({
      command: REAL_BINARY,
      leadingArguments: [],
    });
  });
});
