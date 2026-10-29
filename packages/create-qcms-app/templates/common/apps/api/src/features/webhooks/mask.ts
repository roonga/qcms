// Masking happens in the API response, not in the admin's rendering, so a second client
// of the same route cannot see round it (Q58).

// A fixed token rather than per-value masking: parameter names are as revealing as their
// values, and a fixed token cannot be reversed by counting characters.
export const MASKED_QUERY = "(hidden)";

// String surgery rather than `new URL()`: this runs on the way out of a read, where a
// parse failure must not be able to throw.
export function maskEndpointUrl(url: string): string {
  const query = url.indexOf("?");
  if (query === -1) return url;
  return `${url.slice(0, query)}?${MASKED_QUERY}`;
}

export function endpointUrlFor(url: string, visibility: "whole" | "masked" | undefined): string {
  // Fail closed: a row the middleware did not classify is masked rather than shown.
  return visibility === "whole" ? url : maskEndpointUrl(url);
}
