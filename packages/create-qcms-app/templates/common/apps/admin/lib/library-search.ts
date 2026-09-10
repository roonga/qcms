/**
 * The shared bound on a library list's search term (issues #686, #862).
 *
 * Both library screens - questions and forms - send their search box straight to the
 * API, which caps the term at 200 characters and answers 400 past it. The API states that
 * cap once, as `LIBRARY_SEARCH_MAX_LENGTH` in `apps/api/src/openapi.ts`, and both its
 * library query schemas read it from there. A term is matched per row, so an unbounded
 * one is unbounded work, and the API's refusal is the enforcement.
 *
 * This is a second copy of the number and cannot be anything else: the admin never
 * imports from the API, it proxies to it (R2). The contract test in
 * `apps/api/src/openapi-document.test.ts` reads the bound off the published document, so
 * the two copies are checked against one artifact rather than against each other.
 *
 * This constant is the client-side half: it feeds the input's `maxLength`, so the browser
 * stops the author at the bound instead of letting them submit a term the API will refuse
 * with an error page. It is a courtesy, never a guard - nothing here is trusted, and a
 * hand-edited URL still meets the API's bound.
 *
 * One constant for both screens because the two libraries are the same screen twice: a
 * term one of them accepts is a term the other accepts, and two copies of `200` in two
 * page files is how that stops being true.
 */
export const LIBRARY_SEARCH_MAX_LENGTH = 200;
