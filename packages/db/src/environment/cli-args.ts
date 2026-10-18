/**
 * `qcms-db-environment`'s argument parsing, as a pure function (task 067).
 *
 * Its own module so it can be **tested**, which the entry file cannot be: that file ends
 * with `process.exitCode = await main()`, so importing it runs the command. The parsing
 * has real rules in it now - three settings flags, a duration that must be a whole number
 * of milliseconds, and two flag combinations that are refused rather than half applied -
 * and a rule nobody can test is a rule that drifts.
 *
 * Pure: no process, no database, no output. Either the parsed arguments or the refusal to
 * print, never both and never a throw.
 */

import { maxEnvironmentNameLength } from "./command.js";

export const USAGE = `Usage:
  qcms-db-environment create <name> [--password <password>]
                                    [--challenge-provider <name>]
                                    [--delivery-snippet-ttl-ms <ms>]
                                    [--outbox-payload-ttl-ms <ms>]
  qcms-db-environment drop <name>
  qcms-db-environment reporting [--workspace <slug> --environment <name> --password <pw>]

  DATABASE_URL must name the migration credential (the role that owns \`control\`).
  A name is lowercase letters and digits, starting with a letter, at most
  ${String(maxEnvironmentNameLength())} bytes, and not a reserved word.

  The three settings flags are ADR-24's per-environment set (Q11): the challenge
  provider the respondent path uses here, and the two retention windows the sweep
  ages this environment's rows against. Each is optional, and omitting one leaves
  the installation-wide typed value in force.

  \`reporting\` reconciles one reporting view set and one read-only role per
  (workspace, environment) pair (Q26, docs/reporting-view.md). Run it after
  creating a workspace. With all three flags it also creates that one pair's
  role with that credential; without them it creates no role and the grants
  land for the roles an operator has provisioned themselves.`;

export interface ParsedArgs {
  readonly action: "create" | "drop" | "reporting";
  /** The environment name for `create` and `drop`; empty for `reporting`. */
  readonly name: string;
  readonly password?: string;
  /**
   * ADR-24's per-environment settings (Q11), which `create` writes onto the row.
   *
   * Here rather than left to SQL because a column no command can write is a feature an
   * operator cannot use: task 064 created these columns and the `settings` argument, 066
   * reads the challenge provider and 067 reads the two windows, and nothing was passing
   * them. Each is optional and an absent one is `NULL`, which means the installation-wide
   * typed value stands.
   */
  readonly challengeProvider?: string;
  readonly deliverySnippetTtlMs?: number;
  readonly outboxPayloadTtlMs?: number;
  /** `reporting --workspace`: the one pair whose role this run creates. */
  readonly workspace?: string;
  /** `reporting --environment`: the other half of that pair. */
  readonly environment?: string;
}

/**
 * Either the parsed arguments or the refusal to print, never both and never a throw.
 *
 * One shape rather than "a `ParsedArgs` or a string", so a caller cannot mistake a
 * usage message for a name: the two are the same type in the wrong design and this
 * command's whole first act is to tell them apart.
 */
export type ArgResult =
  | { readonly ok: true; readonly args: ParsedArgs }
  | {
      readonly ok: false;
      readonly refusal: string;
    };

function refuse(refusal: string): ArgResult {
  return { ok: false, refusal };
}

export function parseArgs(argv: readonly string[]): ArgResult {
  const [action, ...tail] = argv;
  if (action !== "create" && action !== "drop" && action !== "reporting") return refuse(USAGE);

  // `reporting` takes **no positional name**: the one pair whose role it may create is
  // named by two flags, because an environment name and a workspace slug obey two
  // different rules and a positional pair would read as one thing.
  const name = action === "reporting" ? "" : (tail[0] ?? "");
  if (action !== "reporting" && (name === "" || name.startsWith("-"))) return refuse(USAGE);
  const rest = action === "reporting" ? tail : tail.slice(1);

  const FLAGS = [
    "--password",
    "--workspace",
    "--environment",
    "--challenge-provider",
    "--delivery-snippet-ttl-ms",
    "--outbox-payload-ttl-ms",
  ] as const;
  type Flag = (typeof FLAGS)[number];

  let password: string | undefined;
  let workspace: string | undefined;
  let environment: string | undefined;
  let challengeProvider: string | undefined;
  let deliverySnippetTtlMs: number | undefined;
  let outboxPayloadTtlMs: number | undefined;

  /** A non-negative integer of milliseconds, or the refusal that names what was wrong. */
  function duration(flag: string, raw: string): number | string {
    // `0` is a supported setting for both windows and means "at the next sweep", so the
    // floor is zero rather than one; a negative or a non-integer is a typo and is refused
    // rather than clamped, because clamping would store a policy nobody asked for.
    if (!/^\d+$/.test(raw)) {
      return `${flag} needs a whole number of milliseconds, not ${JSON.stringify(raw)}`;
    }
    return Number(raw);
  }

  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === undefined || !(FLAGS as readonly string[]).includes(flag)) {
      return refuse(`unknown argument ${String(flag)}\n${USAGE}`);
    }
    const value = rest[i + 1];
    if (value === undefined) return refuse(`${flag} needs a value`);
    switch (flag as Flag) {
      case "--password":
        password = value;
        break;
      case "--workspace":
        workspace = value;
        break;
      case "--environment":
        environment = value;
        break;
      case "--challenge-provider":
        challengeProvider = value;
        break;
      case "--delivery-snippet-ttl-ms": {
        const parsed = duration(flag, value);
        if (typeof parsed === "string") return refuse(parsed);
        deliverySnippetTtlMs = parsed;
        break;
      }
      case "--outbox-payload-ttl-ms": {
        const parsed = duration(flag, value);
        if (typeof parsed === "string") return refuse(parsed);
        outboxPayloadTtlMs = parsed;
        break;
      }
    }
    i += 1;
  }

  const settingsGiven =
    challengeProvider !== undefined ||
    deliverySnippetTtlMs !== undefined ||
    outboxPayloadTtlMs !== undefined;
  if (action !== "create" && settingsGiven) {
    return refuse(
      `${action} takes none of the per-environment settings flags: they are written when ` +
        `an environment is created\n${USAGE}`,
    );
  }

  if (action === "drop" && password !== undefined) return refuse("drop takes no --password");
  if (action !== "reporting" && (workspace !== undefined || environment !== undefined)) {
    return refuse(`${action} takes no --workspace or --environment\n${USAGE}`);
  }
  // All three or none. A password with no pair names no role to create, and a pair with
  // no password would create a role nobody can log in as, which looks like success and is
  // not - so it is refused rather than half done.
  if (action === "reporting") {
    const given = [password, workspace, environment].filter((value) => value !== undefined).length;
    if (given !== 0 && given !== 3) {
      return refuse(
        "reporting takes --workspace, --environment and --password together or none of " +
          "them: creating a role needs the pair it belongs to and a credential it logs " +
          `in with\n${USAGE}`,
      );
    }
  }

  return {
    ok: true,
    args: {
      action,
      name,
      ...(password === undefined ? {} : { password }),
      ...(workspace === undefined ? {} : { workspace }),
      ...(environment === undefined ? {} : { environment }),
      ...(challengeProvider === undefined ? {} : { challengeProvider }),
      ...(deliverySnippetTtlMs === undefined ? {} : { deliverySnippetTtlMs }),
      ...(outboxPayloadTtlMs === undefined ? {} : { outboxPayloadTtlMs }),
    },
  };
}

