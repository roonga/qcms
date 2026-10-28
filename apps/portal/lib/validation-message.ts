import type { AuthorMessages } from "@roonga/qcms-ui";

/**
 * Chooses the wording for a refused answer's constraint (ADR-32). The kernel and the API
 * stay the validation authority: nothing here evaluates a constraint, and no author
 * message ever reaches the server. The fallback is per constraint, not per question,
 * because the compiled document carries only the keys an author wrote.
 *
 * No `@roonga/qcms-ui` value is imported, only its types: the no-JS BFF route reads a
 * 422's constraint out of an API error, and that package's entry point pulls in React
 * client components a route handler cannot load.
 */

export interface AnswerRejection {
  readonly constraint?: string | undefined;
  /** The kernel's built-in message, quoting constraint bounds but never the value. */
  readonly message?: string | undefined;
}

/**
 * The first entry only: the portal shows one message per field, and the kernel lists
 * constraints in definition order, so the first is the most specific thing the
 * respondent can act on. Total over unknown input, because a malformed detail must
 * degrade to the default message rather than throw.
 */
export function firstAnswerRejection(details: unknown): AnswerRejection | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const errors = (details as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;
  const first: unknown = errors[0];
  if (typeof first !== "object" || first === null) return undefined;
  const { constraint, message } = first as { constraint?: unknown; message?: unknown };
  return {
    constraint: typeof constraint === "string" ? constraint : undefined,
    message: typeof message === "string" && message !== "" ? message : undefined,
  };
}

/**
 * One function, because both portal paths have to answer this identically: the hydrated
 * one once went straight to the generic catalogue entry, so switching JavaScript on made
 * the message strictly less informative.
 *
 * The whole precedence is authored, then the kernel's, then the catalogue's.
 */
export function defaultAnswerMessage(
  rejection: AnswerRejection | undefined,
  fallback: string,
): string {
  return rejection?.message ?? fallback;
}

/**
 * The envelope's shape is known in exactly one place. The BFF forwards the API's typed
 * detail verbatim and adds no meaning of its own (R2).
 */
export function errorDetailsOf(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { details?: unknown }).details;
}

/** The API's own vocabulary, forwarded verbatim and never a portal invention (R2). */
export function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * An exhaustive `Record` over `AuthorMessages`, so a key added to or removed from that
 * schema is a build error here rather than a message that silently never resolves.
 */
const AUTHORABLE_KEYS: Readonly<Record<keyof AuthorMessages, true>> = {
  required: true,
  minLength: true,
  maxLength: true,
  pattern: true,
  min: true,
  max: true,
  integer: true,
  minSelected: true,
  maxSelected: true,
};

/**
 * `Object.hasOwn`, never `in`: `in` walks the prototype chain, so `toString`,
 * `constructor`, `valueOf` and `__proto__` would all answer true and this predicate
 * would narrow untrusted input to a key it had not established, after which the lookup
 * returns an inherited function typed as `string`.
 */
function isAuthoredKey(key: string): key is keyof AuthorMessages {
  return Object.hasOwn(AUTHORABLE_KEYS, key);
}

export function authorMessageFor(
  messages: AuthorMessages | undefined,
  constraint: string | undefined,
): string | undefined {
  if (messages === undefined || constraint === undefined) return undefined;
  if (!isAuthoredKey(constraint)) return undefined;
  const message = messages[constraint];
  return message === undefined || message === "" ? undefined : message;
}
