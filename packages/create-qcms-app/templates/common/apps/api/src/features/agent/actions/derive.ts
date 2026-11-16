import { z } from "zod";

import type { ActionRequestFacts } from "./types.js";

/**
 * A kind's arguments built from its route's own request body: the member schemas are the
 * route's, so a tightened limit, a new enum or a format reaches the model without being
 * retyped, and a body member that appears, disappears or is renamed fails the type check
 * rather than drifting.
 */

/**
 * The exact argument set a kind may declare for a route whose body is `Shape`: every member
 * `Unnamed` does not list, plus the arguments `Beyond` names because the path or a nested
 * body member carries them. Applied with `satisfies`, so a missing and an excess argument
 * both fail.
 */
export type StepArgs<Shape, Unnamed extends keyof Shape & string, Beyond extends string> = Record<
  Exclude<keyof Shape & string, Unnamed> | Beyond,
  z.ZodType
>;

/** A member without the route's own default or optionality, for an argument a step states. */
export function stated<T extends z.ZodType>(member: z.ZodDefault<T> | z.ZodOptional<T>): T {
  return member.unwrap();
}

/** How a request carries one argument, where the body does not carry it under its own name. */
export type ArgReader = (facts: ActionRequestFacts) => unknown;

export function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

/** A path parameter as the card displayed it, which for a version is a number. */
export function wholeParam(name: string): ArgReader {
  return (facts) => Number.parseInt(facts.params[name] ?? "", 10);
}

export interface RouteArgsSpec {
  /**
   * The body members no step names: the server derives them, the switcher supplies them, or
   * the step names their members through an argument of its own. A member in neither this
   * list nor the arguments is the drift this declaration exists to refuse.
   */
  readonly unnamed?: readonly string[];
  /** Argument name to the route path's own placeholder, which is also how it is recomputed. */
  readonly params?: Readonly<Record<string, string>>;
  /** An argument the body does not carry under its own name, with its reader. */
  readonly readers?: Readonly<Record<string, ArgReader>>;
}

/** What the guard test checks a kind's arguments against: the route's body and what it skips. */
export interface ArgsDerivation {
  readonly body: z.ZodType;
  readonly unnamed: readonly string[];
}

export interface RouteArgs {
  readonly args: z.ZodObject;
  readonly argsFrom: ArgsDerivation;
  readonly recomputeArgs: (facts: ActionRequestFacts) => unknown;
}

function shapeOf(schema: z.ZodType): Readonly<Record<string, z.ZodType>> {
  return (schema as unknown as { readonly shape: Record<string, z.ZodType> }).shape;
}

/** The value the route's own schema supplies where a request omits this member. */
function routeDefault(member: z.ZodType | undefined): unknown {
  const def = (member as unknown as { readonly def?: { readonly defaultValue?: unknown } })?.def;
  const value = def?.defaultValue;
  return typeof value === "function" ? (value as () => unknown)() : value;
}

function accepts(member: z.ZodType, value: unknown): boolean {
  return member.safeParse(value).success;
}

function readerFor(
  name: string,
  body: Readonly<Record<string, z.ZodType>>,
  spec: RouteArgsSpec,
): ArgReader {
  const own = spec.readers?.[name];
  if (own !== undefined) return own;
  const placeholder = spec.params?.[name];
  if (placeholder !== undefined) return (facts) => facts.params[placeholder] ?? "";
  // Only an absent member takes the default: `null` is a value the card displays.
  const fallback = routeDefault(body[name]);
  return (facts) => {
    const value = bodyMember(facts, name);
    return value === undefined ? fallback : value;
  };
}

function refuse(message: string): never {
  throw new Error(`Action arguments do not match the route body: ${message}`);
}

function checkCover(
  args: Readonly<Record<string, z.ZodType>>,
  body: Readonly<Record<string, z.ZodType>>,
  spec: RouteArgsSpec,
): void {
  const unnamed = spec.unnamed ?? [];
  for (const member of unnamed) {
    if (!Object.hasOwn(body, member)) refuse(`the body carries no "${member}" to leave unnamed`);
  }
  for (const member of Object.keys(body)) {
    if (!unnamed.includes(member) && !Object.hasOwn(args, member)) {
      refuse(`"${member}" is neither an argument nor unnamed`);
    }
  }
  for (const name of [...Object.keys(spec.params ?? {}), ...Object.keys(spec.readers ?? {})]) {
    if (!Object.hasOwn(args, name)) refuse(`"${name}" is read back but is not an argument`);
  }
  for (const name of Object.keys(args)) {
    const carried =
      Object.hasOwn(body, name) ||
      Object.hasOwn(spec.params ?? {}, name) ||
      Object.hasOwn(spec.readers ?? {}, name);
    if (!carried) refuse(`no request member or reader gives "${name}" back`);
  }
}

/**
 * One kind's `args`, its derivation and its `recomputeArgs`. An argument is read back off a
 * request under its own name, from the path placeholder the step names, or through its own
 * reader, with the body's default standing in where the request omits the member and an
 * absent optional member left out, so both sides digest the same object.
 */
export function routeArgs(
  body: z.ZodType,
  args: Readonly<Record<string, z.ZodType>>,
  spec: RouteArgsSpec,
): RouteArgs {
  const members = shapeOf(body);
  checkCover(args, members, spec);
  const readers = Object.keys(args).map(
    (name) => [name, args[name], readerFor(name, members, spec)] as const,
  );
  return {
    args: z.strictObject(args),
    argsFrom: { body, unnamed: spec.unnamed ?? [] },
    recomputeArgs: (facts) => {
      const out: Record<string, unknown> = {};
      for (const [name, member, read] of readers) {
        const value = read(facts);
        // An optional member absent from the request is absent from the card too; a required
        // one keeps its key, and the canonical digest drops an `undefined` either way.
        if (value === undefined && member !== undefined && accepts(member, undefined)) continue;
        out[name] = value;
      }
      return out;
    },
  };
}
