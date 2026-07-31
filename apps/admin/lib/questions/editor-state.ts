import type { DefinitionIssue } from "./types.ts";

/**
 * What a question mutation reports back to the screen that submitted it (task 032).
 *
 * This lives beside the types rather than inside the actions module because a
 * `"use server"` module may only export async functions: a shared constant or an
 * interface declared there is a build error, and the failure message does not say so
 * clearly. Splitting the state out is the standard way around it and it also lets a
 * client component name the type without pulling the server module into its graph.
 */
export interface MutationState {
  readonly status: "idle" | "saved" | "error";
  /** The API's own error code, kept so a bug report can name it. */
  readonly code?: string;
  /** The human sentence for that code. */
  readonly message?: string;
  /** Kernel issues, each addressed by a domain path the editor maps onto a field. */
  readonly issues?: readonly DefinitionIssue[];
}

/** The starting state of every mutation form: nothing submitted, nothing to report. */
export const IDLE_MUTATION: MutationState = { status: "idle" };
