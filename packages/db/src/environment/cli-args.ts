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

/** The three subcommands. */
const ACTIONS = ["create", "drop", "reporting"] as const;
type Action = (typeof ACTIONS)[number];

/** Every flag any subcommand takes. An argument outside this set is refused by name. */
const FLAGS = [
  "--password",
  "--workspace",
  "--environment",
  "--challenge-provider",
  "--delivery-snippet-ttl-ms",
  "--outbox-payload-ttl-ms",
] as const;
type Flag = (typeof FLAGS)[number];

/** The flags one invocation carried, by flag, before any rule is applied to them. */
type FlagValues = Partial<Record<Flag, string>>;

/**
 * A step's outcome: a value, or the refusal to print.
 *
 * One shape for every step rather than `T | string`, so no step returns two different
 * kinds of thing and a caller cannot mistake a usage message for a value - the same reason
 * {@link ArgResult} has this shape.
 */
type Step<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: string };

function bad<T>(refusal: string): Step<T> {
  return { ok: false, refusal };
}

/**
 * Collect `--flag value` pairs, or the refusal naming the first thing that was not one.
 *
 * Collection and **validation are deliberately separate passes**: which flags a
 * subcommand may carry, and what a value has to look like, are rules about the command
 * rather than about parsing, and reading them in one loop is how this function came to be
 * long enough for the complexity gate to refuse it.
 */
function collectFlags(rest: readonly string[]): Step<FlagValues> {
  const values: FlagValues = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (flag === undefined || !(FLAGS as readonly string[]).includes(flag)) {
      return bad(`unknown argument ${String(flag)}\n${USAGE}`);
    }
    const value = rest[i + 1];
    if (value === undefined) return bad(`${flag} needs a value`);
    values[flag as Flag] = value;
  }
  return { ok: true, value: values };
}

/**
 * A non-negative whole number of milliseconds, or `undefined` when the text is not one.
 *
 * `0` is a supported setting for both retention windows and means "at the next sweep", so
 * the floor is zero rather than one. A negative or a fractional value is a typo and is
 * **refused rather than clamped**, because clamping would store a policy nobody asked for.
 */
function duration(raw: string): number | undefined {
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/**
 * The settings flags of ADR-24's per-environment set, parsed, or the refusal.
 *
 * They belong to `create` alone: they are written onto the environment row when it is
 * created, and a subcommand that accepted and dropped them would be the worst of both.
 */
function settingsFrom(action: Action, values: FlagValues): Step<Partial<ParsedArgs>> {
  const challengeProvider = values["--challenge-provider"];
  const snippet = values["--delivery-snippet-ttl-ms"];
  const payload = values["--outbox-payload-ttl-ms"];
  if (action !== "create" && (challengeProvider ?? snippet ?? payload) !== undefined) {
    return bad(
      `${action} takes none of the per-environment settings flags: they are written when ` +
        `an environment is created\n${USAGE}`,
    );
  }
  const parsed: Partial<ParsedArgs> = {};
  if (challengeProvider !== undefined) Object.assign(parsed, { challengeProvider });
  for (const [flag, key, raw] of [
    ["--delivery-snippet-ttl-ms", "deliverySnippetTtlMs", snippet],
    ["--outbox-payload-ttl-ms", "outboxPayloadTtlMs", payload],
  ] as const) {
    if (raw === undefined) continue;
    const ms = duration(raw);
    if (ms === undefined) {
      return bad(`${flag} needs a whole number of milliseconds, not ${JSON.stringify(raw)}`);
    }
    Object.assign(parsed, { [key]: ms });
  }
  return { ok: true, value: parsed };
}

/** The rules about which of the remaining flags each subcommand may carry. */
function refuseFlagCombination(action: Action, values: FlagValues): string | undefined {
  const password = values["--password"];
  const workspace = values["--workspace"];
  const environment = values["--environment"];

  if (action === "drop" && password !== undefined) return "drop takes no --password";
  if (action !== "reporting" && (workspace ?? environment) !== undefined) {
    return `${action} takes no --workspace or --environment\n${USAGE}`;
  }
  if (action !== "reporting") return undefined;

  // All three or none. A password with no pair names no role to create, and a pair with no
  // password would create a role nobody can log in as, which looks like success and is
  // not - so it is refused rather than half done.
  const given = [password, workspace, environment].filter((value) => value !== undefined).length;
  if (given === 0 || given === 3) return undefined;
  return (
    "reporting takes --workspace, --environment and --password together or none of them: " +
    `creating a role needs the pair it belongs to and a credential it logs in with\n${USAGE}`
  );
}

export function parseArgs(argv: readonly string[]): ArgResult {
  const [action, ...tail] = argv;
  if (!(ACTIONS as readonly (string | undefined)[]).includes(action)) return refuse(USAGE);
  const subcommand = action as Action;

  // `reporting` takes **no positional name**: the one pair whose role it may create is
  // named by two flags, because an environment name and a workspace slug obey two
  // different rules and a positional pair would read as one thing.
  const name = subcommand === "reporting" ? "" : (tail[0] ?? "");
  if (subcommand !== "reporting" && (name === "" || name.startsWith("-"))) return refuse(USAGE);

  const collected = collectFlags(subcommand === "reporting" ? tail : tail.slice(1));
  if (!collected.ok) return refuse(collected.refusal);
  const values = collected.value;

  const combination = refuseFlagCombination(subcommand, values);
  if (combination !== undefined) return refuse(combination);

  const settings = settingsFrom(subcommand, values);
  if (!settings.ok) return refuse(settings.refusal);

  const named = {
    password: values["--password"],
    workspace: values["--workspace"],
    environment: values["--environment"],
  };
  return {
    ok: true,
    args: {
      action: subcommand,
      name,
      ...Object.fromEntries(Object.entries(named).filter(([, value]) => value !== undefined)),
      ...settings.value,
    },
  };
}
