// Its own module so it can be tested: importing the entry file runs the command.

import { maxEnvironmentNameLength } from "./command.js";

export const USAGE = `Usage:
  qcms-db-environment create <name> [--password <password>]
                                    [--challenge-provider <name>]
                                    [--delivery-snippet-ttl-ms <ms>]
                                    [--outbox-payload-ttl-ms <ms>]
  qcms-db-environment drop <name>
  qcms-db-environment reporting [--workspace <slug> --environment <name> --password <pw>]
  qcms-db-environment regrant

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
  land for the roles an operator has provisioned themselves.

  \`regrant\` takes no name and no flag: it re-applies every grant and revoke in
  the model, for every environment in \`control.environments\`. It is the step a
  RESTORE needs, because \`pg_dump --no-privileges\` carries no grant and the
  drizzle journal rides inside the dump, so a post-restore migrate re-applies
  nothing (issue #1094). It is idempotent.`;

export interface ParsedArgs {
  readonly action: "create" | "drop" | "reporting" | "regrant";
  /** The environment name for `create` and `drop`; empty for `reporting` and `regrant`. */
  readonly name: string;
  readonly password?: string;
  /** An absent setting is `NULL`, which leaves the installation-wide typed value. */
  readonly challengeProvider?: string;
  readonly deliverySnippetTtlMs?: number;
  readonly outboxPayloadTtlMs?: number;
  readonly workspace?: string;
  readonly environment?: string;
}

export type ArgResult =
  | { readonly ok: true; readonly args: ParsedArgs }
  | {
      readonly ok: false;
      readonly refusal: string;
    };

function refuse(refusal: string): ArgResult {
  return { ok: false, refusal };
}

const ACTIONS = ["create", "drop", "reporting", "regrant"] as const;
type Action = (typeof ACTIONS)[number];

const FLAGS = [
  "--password",
  "--workspace",
  "--environment",
  "--challenge-provider",
  "--delivery-snippet-ttl-ms",
  "--outbox-payload-ttl-ms",
] as const;
type Flag = (typeof FLAGS)[number];

type FlagValues = Partial<Record<Flag, string>>;

type Step<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: string };

function bad<T>(refusal: string): Step<T> {
  return { ok: false, refusal };
}

function collectFlags(rest: readonly string[]): Step<FlagValues> {
  const values: FlagValues = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (flag === undefined || !(FLAGS as readonly string[]).includes(flag)) {
      return bad(`unknown argument ${String(flag)}\n${USAGE}`);
    }
    const value = rest[i + 1];
    if (value === undefined) return bad(`${flag} needs a value`);
    // Narrowed by the `includes` guard above, which TypeScript cannot carry across a
    // `readonly string[]` membership test.
    values[flag as Flag] = value;
  }
  return { ok: true, value: values };
}

/** `0` is a supported retention window and means "at the next sweep". */
function duration(raw: string): number | undefined {
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

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

function refuseFlagCombination(action: Action, values: FlagValues): string | undefined {
  const password = values["--password"];
  const workspace = values["--workspace"];
  const environment = values["--environment"];

  if (action === "regrant" && Object.keys(values).length > 0) {
    return `regrant takes no arguments\n${USAGE}`;
  }
  if (action === "drop" && password !== undefined) return "drop takes no --password";
  if (action !== "reporting" && (workspace ?? environment) !== undefined) {
    return `${action} takes no --workspace or --environment\n${USAGE}`;
  }
  if (action !== "reporting") return undefined;

  // All three or none: a pair with no password would create a role nobody can log in as.
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
  // The guard above is a membership test over a widened array, which does not narrow
  // `action` on its own.
  const subcommand = action as Action;

  const unnamed = subcommand === "reporting" || subcommand === "regrant";
  const name = unnamed ? "" : (tail[0] ?? "");
  if (!unnamed && (name === "" || name.startsWith("-"))) return refuse(USAGE);
  if (subcommand === "regrant" && tail.length > 0) {
    return refuse(`regrant takes no arguments\n${USAGE}`);
  }

  const collected = collectFlags(unnamed ? tail : tail.slice(1));
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
