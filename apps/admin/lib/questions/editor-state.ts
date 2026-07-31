import type { DefinitionIssue, QuestionDefinitionView } from "./types.ts";

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
  /**
   * The rejected submission, echoed back so the editor can restore it.
   *
   * This is not belt and braces, it is the only thing that makes a rejection survivable.
   * A form with a server action posts as a **full navigation** whenever it is submitted
   * before React has hydrated, which under `next dev` on a first visit is routine: the
   * page then comes back freshly server-rendered, every `useState` in the editor
   * reinitialised, and the author's entire document gone - while the error explaining why
   * it was refused sits at the top of an empty form. Round-tripping the document through
   * the action's own state is what survives that, because the state is rendered by the
   * server and therefore arrives with the new document rather than being lost with the
   * old one.
   */
  readonly submitted?: {
    readonly slug: string;
    readonly definition: QuestionDefinitionView;
  };
}

/** The starting state of every mutation form: nothing submitted, nothing to report. */
export const IDLE_MUTATION: MutationState = { status: "idle" };
