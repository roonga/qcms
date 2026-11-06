import type { DefinitionIssue, QuestionDefinitionView } from "./types.ts";

// Keep shared state outside use-server modules, which may export only async functions.
export interface MutationState {
  readonly status: "idle" | "saved" | "error";

  readonly code?: string;

  readonly message?: string;

  readonly issues?: readonly DefinitionIssue[];
  // Echo rejected content in action state: a pre-hydration submission navigates and reinitialises client state.
  // Without the echo the author receives an error beside an empty document.
  readonly submitted?: {
    readonly slug: string;
    readonly definition: QuestionDefinitionView;
  };
}

export const IDLE_MUTATION: MutationState = { status: "idle" };

export interface QuestionCardState {
  readonly status: "done" | "error";
  readonly questionId?: string;
  readonly slug?: string;
  readonly version?: number;
  readonly versionStatus?: string;
  readonly message?: string;
  /* The definition issues the API reported, so a card can say what it refused and why. */
  readonly issues?: readonly DefinitionIssue[];
}
