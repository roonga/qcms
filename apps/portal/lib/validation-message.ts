import type { AuthorMessages } from "@qcms/ui";

/**
 * Author-supplied validation messages at the portal seam (task 048, ADR-32).
 *
 * The kernel and API stay the validation authority: a refused answer comes back
 * as a typed 422 naming the stable error `code` and the `constraint` that failed.
 * What this module does is choose the *wording* for that constraint - the
 * author's own if they wrote one for it, otherwise the portal's default catalog
 * entry, unchanged. Nothing here evaluates a constraint, and no author message
 * ever reaches the server.
 *
 * The fallback is per constraint, not per question: an author who overrode only
 * `pattern` still gets the default wording for `minLength`, because the compiled
 * document carries the keys they wrote and nothing else.
 *
 * Nothing here imports a `@qcms/ui` VALUE (the `AuthorMessages` shape is
 * type-only). That is deliberate: the no-JS BFF route reads a 422's constraint
 * out of an API error, and `@qcms/ui`'s entry point pulls the React client
 * components in, which a route handler cannot load. Reading the messages off a
 * compiled document lives in `visible.ts`, beside the other document walkers,
 * and is only ever called from a client component.
 */

/** One entry of the API's 422 answer-validation detail. */
export interface AnswerRejection {
  /** Which constraint failed (`"pattern"`, `"minLength"`, `"encoding"`, …). */
  readonly constraint?: string | undefined;
  /** The kernel's built-in message, quoting constraint bounds but never the value. */
  readonly message?: string | undefined;
}

/**
 * The first entry of an API 422's `details.errors`, or `undefined` for any other
 * shape. Deliberately the first only: the portal shows one message per field, and
 * the kernel lists constraints in definition order, so the first is the most
 * specific thing the respondent can act on. Total over unknown input - a
 * malformed detail must degrade to the default message, never throw.
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
 * The DEFAULT wording for a refused answer: the kernel's own message for the
 * constraint that failed, else the portal's generic catalog entry.
 *
 * One function because both portal paths must answer this question identically
 * (issue #322). They did not: the no-JS BFF route resolved the kernel's specific
 * wording ("Answer must be at least 3 characters") while the hydrated flow went
 * straight to `answer.invalid` ("That answer is not valid."), so switching
 * JavaScript ON made the message strictly less informative. Neither path's own
 * tests could see it, because each was individually green about its own string.
 *
 * The author's message still wins over whatever this returns, on both paths and
 * per constraint (`authorMessageFor`, ADR-32). That ordering is the whole
 * precedence: authored, then the kernel's, then the catalog's. The hydrated path
 * applies both halves in one place (`components/step-flow.tsx`); the no-JS path
 * splits them across the seam it is made of, the route resolving this default and
 * `components/native-step.tsx` overriding it at render time, which is where the
 * compiled document with the author's messages in it is finally in hand.
 */
export function defaultAnswerMessage(
  rejection: AnswerRejection | undefined,
  fallback: string,
): string {
  return rejection?.message ?? fallback;
}

/**
 * The `details` payload out of a BFF error body (`{ error: { code, details } }`),
 * or `undefined` for anything else. The BFF forwards the API's typed detail
 * verbatim (R2: it adds no meaning of its own), so this is the one place that
 * knows the envelope's shape.
 */
export function errorDetailsOf(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { details?: unknown }).details;
}

/**
 * The constraints an author may decorate, as an object so membership is a plain
 * property test. Typed as an exhaustive `Record` over `AuthorMessages`, so a key
 * added to (or removed from) `@qcms/ui`'s schema is a build error here rather
 * than a message that silently never resolves.
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
 * Is `key` a constraint an author may have written a message for? An
 * unauthorable one (`encoding`, `options` - a value that is not a legal answer of
 * the question's type at all) simply misses, and falls through to the default.
 *
 * `Object.hasOwn`, never `in` (issue #324): `in` walks the prototype chain, so
 * `toString`, `constructor`, `valueOf` and `__proto__` would all answer true and
 * this predicate would narrow untrusted input to a `keyof AuthorMessages` it had
 * not actually established. The lookup below would then return an inherited
 * function typed as `string`. The test file pins the four prototype keys so a
 * later simplification back to `in` fails rather than passing review.
 */
function isAuthoredKey(key: string): key is keyof AuthorMessages {
  return Object.hasOwn(AUTHORABLE_KEYS, key);
}

/**
 * The author's message for one constraint of one question, or `undefined` when
 * they inherited it (which every caller renders as its own default).
 */
export function authorMessageFor(
  messages: AuthorMessages | undefined,
  constraint: string | undefined,
): string | undefined {
  if (messages === undefined || constraint === undefined) return undefined;
  if (!isAuthoredKey(constraint)) return undefined;
  const message = messages[constraint];
  return message === undefined || message === "" ? undefined : message;
}
