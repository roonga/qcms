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
  /**
   * The exact set of body members this kind's request carries, for a route that serves
   * more than one act. One route and one method can mean three different things to an
   * operator, and each wants its own card; the set is what tells them apart. A body whose
   * members match no kind resolves to none and is refused.
   */
  readonly bodyMembers?: readonly string[];
}

export interface ActionRequestFacts {
  /** The matched route path, with its placeholders. */
  readonly path: string;
  readonly method: string;

  readonly params: Readonly<Record<string, string>>;
  /** The parsed JSON body, or `undefined` for a route that takes none. */
  readonly body: unknown;
  /** The environment the request is performed in, from the route policy's own source. */
  readonly environment: string;
}

export interface ActionCardTemplate {
  readonly titleKey: string;
  /** The catalog keys of the consequence sentences the screen's own dialog uses. */
  readonly consequenceKeys: readonly string[];

  readonly headingControl?: string;
  /**
   * For a kind that creates something: the page route the card links the new item at, and
   * the result field that fills the route's own id. A page route only, so a card can never
   * link at a route handler.
   */
  readonly createdLink?: {
    readonly screen: ScreenId;
    readonly field: string;
  };
  /**
   * The argument whose value the user retypes on the card before Confirm is enabled, for a
   * step whose own dialog asks for one. The card is never weaker than that dialog.
   */
  readonly typedConfirmation?: string;
}

export interface ActionKindDef {
  readonly kind: string;

  readonly screen: ScreenId;
  /**
   * Absent for a hand-off and for a local step: both carry no token, so no request is ever
   * routed to them.
   */
  readonly route?: ActionRoute;
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
  /**
   * The arguments as the card displays them and the digest binds them, where a member the
   * model may send is the server's own to derive. `recomputeArgs` applies the same rule to
   * the request, so the two sides agree.
   */
  readonly normaliseArgs?: (
    args: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
  /** What the card displays, which is what the digest is taken over. */
  recomputeArgs(facts: ActionRequestFacts): unknown;
  /**
   * The result field a later step may reference, which is the value this kind's audit row
   * records as its `detail`. At most one: a row carries one detail, so a second field
   * could be named at propose and never verified.
   */
  readonly references: readonly [] | readonly [string];
  /** The non-secret result fields the next turn may learn (section 7.6). */
  readonly resultAllowlist: readonly string[];
  /** A step whose arguments include a secret the user must type; carries no token. */
  readonly handOff?: true;
  /**
   * A step the screen completes through its own client-side write path rather than a
   * request of its own. It reaches no route, so it carries no token and the screen's own
   * save is what authorises it.
   */
  readonly local?: true;
  /**
   * The draft this kind applies is the turn's own proposed draft rather than an argument,
   * so the propose tool refuses the step until one has been proposed and attaches the
   * server's two advisory lists to it.
   */
  readonly carriesProposedDraft?: true;
  /**
   * The draft this kind saves is its own `definition` argument, so the propose tool
   * validates that argument and attaches the server's two advisory lists to the step, as it
   * does for the kind that applies a proposed draft.
   */
  readonly carriesDraftArgument?: true;
  readonly card: ActionCardTemplate;
  readonly description: string;
}
