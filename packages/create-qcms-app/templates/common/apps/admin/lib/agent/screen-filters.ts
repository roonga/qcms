import { parseResponseQuery } from "../ops/response-filters";

import type { AgentResponseFilters, AgentScreenParams, ResolvedScreen } from "./screens";

/**
 * The response list's filters, read off the address the operator is looking at.
 *
 * Through the same parse the screen itself uses, so the facts the agent is given describe
 * the rows on screen and the SEC-15 `read` row records that filter set rather than the
 * unfiltered list. A value the screen would ignore is no filter here either.
 */
export const FILTERED_SCREEN = "/forms/[formId]/responses";

export function screenWithFilters(
  resolved: ResolvedScreen | undefined,
  search: URLSearchParams | undefined,
): ResolvedScreen | undefined {
  if (resolved === undefined || resolved.screen !== FILTERED_SCREEN) return resolved;
  const filters = responseFilters(search);
  if (filters === undefined) return resolved;
  const params: AgentScreenParams = { ...resolved.params, filters };
  return { screen: resolved.screen, params };
}

function responseFilters(search: URLSearchParams | undefined): AgentResponseFilters | undefined {
  if (search === undefined) return undefined;
  const { request } = parseResponseQuery(Object.fromEntries(search.entries()));
  const filters: AgentResponseFilters = {
    ...(request.version === undefined ? {} : { version: Number(request.version) }),
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.to === undefined ? {} : { to: request.to }),
    ...(request.flagged === undefined ? {} : { flagged: request.flagged === "true" }),
  };
  return Object.keys(filters).length === 0 ? undefined : filters;
}
