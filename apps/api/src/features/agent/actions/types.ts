import type { z } from "zod";

import type { Resource } from "../../membership/policy.js";
import type { ScreenId } from "../screens.js";

/**
 * One action kind's descriptor (section 6.2). It is the whole of what the propose tools,
 * the grant filter and the provenance check know about a kind, so none can be
 * half-declared.
 */

/** Where the environment a step acts in comes from, per the kind's route-policy row. */
export type ActionEnvironmentSource = "switcher" | "argument";

export interface ActionRoute {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** As `ROUTE_POLICIES` spells it, so the two are checked against one route tree. */
  readonly path: string;
}

/** What the provenance middleware hands a descriptor to recompute a step's arguments. */
export interface ActionRequestFacts {
  /** The matched route path, with its placeholders. */
  readonly path: string;
  readonly method: string;
  /** The path parameters, by placeholder name. */
  readonly params: Readonly<Record<string, string>>;
  /** The parsed JSON body, or `undefined` for a route that takes none. */
  readonly body: unknown;
  /** The environment the request is performed in, from the route policy's own source. */
  readonly environment: string;
}

export interface ActionCardTemplate {
  /** The catalog key of the step title the admin renders. */
  readonly titleKey: string;
  /** The catalog keys of the consequence sentences the screen's own dialog uses. */
  readonly consequenceKeys: readonly string[];
  /** The heading-row control the proposal marker sits on, or none. */
  readonly headingControl?: string;
}

export interface ActionKindDef {
  readonly kind: string;
  /** The screen whose control this kind mirrors, which is where its marker shows. */
  readonly screen: ScreenId;
  readonly route: ActionRoute;
  readonly cell: { readonly resource: Resource; readonly action: string };
  /** A second cell the route also requires, as its policy row declares it. */
  readonly alsoCell?: { readonly resource: Resource; readonly action: string };
  readonly environmentFrom: ActionEnvironmentSource;
  /**
   * The name of the argument carrying the environment, when `environmentFrom` is
   * `argument`. The grant filter narrows this member's enum to the caller's environments.
   */
  readonly environmentArgument?: string;
  readonly args: z.ZodType;
  /** What the card displays, which is what the digest is taken over. */
  recomputeArgs(facts: ActionRequestFacts): unknown;
  /** The result fields a later step may reference, and the audit row's own detail. */
  readonly references: readonly string[];
  /** The non-secret result fields the next turn may learn (section 7.6). */
  readonly resultAllowlist: readonly string[];
  /** A step whose arguments include a secret the user must type; carries no token. */
  readonly handOff?: true;
  readonly card: ActionCardTemplate;
  readonly description: string;
}
