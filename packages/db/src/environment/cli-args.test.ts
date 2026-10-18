import { describe, expect, it } from "vitest";

import { parseArgs } from "./cli-args.js";

/**
 * `qcms-db-environment`'s argument parsing (tasks 064 and 067).
 *
 * The parsing exists as its own module so these cases can exist at all: the entry file
 * ends with `process.exitCode = await main()`, so a test that imported it would run the
 * command. The rules worth holding are the ones an operator meets at a shell - a duration
 * that is not a number, a flag on the wrong subcommand, and the settings flags that were
 * **unreachable until this task wired them**, which is the defect these cases exist to keep
 * closed: task 064 created the columns and the `settings` argument, 066 reads the challenge
 * provider and 067 reads the two retention windows, and nothing was passing any of them.
 */

function parsed(argv: string[]) {
  const result = parseArgs(argv);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.args;
}

function refusal(argv: string[]): string {
  const result = parseArgs(argv);
  if (result.ok) throw new Error("expected a refusal");
  return result.refusal;
}

describe("create", () => {
  it("takes a name alone", () => {
    expect(parsed(["create", "dev"])).toEqual({ action: "create", name: "dev" });
  });

  it("takes the password and the three per-environment settings (Q11)", () => {
    expect(
      parsed([
        "create",
        "dev",
        "--password",
        "secret",
        "--challenge-provider",
        "turnstile",
        "--delivery-snippet-ttl-ms",
        "0",
        "--outbox-payload-ttl-ms",
        "86400000",
      ]),
    ).toEqual({
      action: "create",
      name: "dev",
      password: "secret",
      challengeProvider: "turnstile",
      // `0` is a supported setting and means "at the next sweep", which is why the floor is
      // zero and why this case asserts it survives rather than being read as absent.
      deliverySnippetTtlMs: 0,
      outboxPayloadTtlMs: 86_400_000,
    });
  });

  it("leaves an omitted setting absent rather than defaulting it", () => {
    // Absent means `NULL` on the row, which means the installation-wide typed value stands.
    // A parser that defaulted here would write a policy nobody asked for.
    const args = parsed(["create", "dev", "--challenge-provider", "none"]);
    expect(args.deliverySnippetTtlMs).toBeUndefined();
    expect(args.outboxPayloadTtlMs).toBeUndefined();
  });

  it("refuses a duration that is not a whole number of milliseconds", () => {
    for (const bad of ["1.5", "-1", "1e3", "soon", ""]) {
      expect(refusal(["create", "dev", "--delivery-snippet-ttl-ms", bad]), bad).toMatch(
        /whole number of milliseconds/,
      );
    }
  });

  it("refuses a flag with no value, and an unknown flag", () => {
    expect(refusal(["create", "dev", "--password"])).toMatch(/--password needs a value/);
    expect(refusal(["create", "dev", "--retention"])).toMatch(/unknown argument --retention/);
  });

  it("refuses a missing name", () => {
    expect(refusal(["create"])).toMatch(/Usage/);
    expect(refusal(["create", "--password", "x"])).toMatch(/Usage/);
  });
});

describe("drop", () => {
  it("takes a name and nothing else", () => {
    expect(parsed(["drop", "dev"])).toEqual({ action: "drop", name: "dev" });
    expect(refusal(["drop", "dev", "--password", "x"])).toMatch(/drop takes no --password/);
  });

  it("refuses the settings flags, which are written at create", () => {
    // Not silently ignored: an operator who typed them expects them to take effect, and a
    // command that accepted and dropped them would be the worst of both.
    expect(refusal(["drop", "dev", "--outbox-payload-ttl-ms", "0"])).toMatch(
      /takes none of the per-environment settings flags/,
    );
  });
});

describe("reporting", () => {
  it("takes no positional name", () => {
    expect(parsed(["reporting"])).toEqual({ action: "reporting", name: "" });
  });

  it("takes the pair and the credential together", () => {
    expect(
      parsed(["reporting", "--workspace", "home", "--environment", "prod", "--password", "secret"]),
    ).toEqual({
      action: "reporting",
      name: "",
      workspace: "home",
      environment: "prod",
      password: "secret",
    });
  });

  it("refuses a partial one-pair form", () => {
    // A password with no pair names no role to create, and a pair with no password would
    // create a role nobody can log in as - which looks like success and is not.
    expect(refusal(["reporting", "--password", "secret"])).toMatch(/together or none of them/);
    expect(refusal(["reporting", "--workspace", "home"])).toMatch(/together or none of them/);
  });

  it("refuses the settings flags, which belong to create", () => {
    expect(refusal(["reporting", "--challenge-provider", "none"])).toMatch(
      /takes none of the per-environment settings flags/,
    );
  });
});

describe("the subcommand itself", () => {
  it("refuses anything that is not one of the three", () => {
    expect(refusal(["rename", "dev"])).toMatch(/Usage/);
    expect(refusal([])).toMatch(/Usage/);
  });

  it("refuses --workspace and --environment on create and drop", () => {
    expect(refusal(["create", "dev", "--workspace", "home"])).toMatch(
      /create takes no --workspace or --environment/,
    );
  });
});
