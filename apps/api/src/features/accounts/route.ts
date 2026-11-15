import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeCreateAccountHandler,
  makeListAccountsHandler,
  makeResendSignInLinkHandler,
} from "./handler.js";
import {
  AccountCreatedResponse,
  AccountDirectoryQueryParams,
  AccountIdParam,
  AccountListResponse,
  CreateAccountBody,
  SignInLinkResponse,
} from "./schema.js";

const tags = ["accounts"];

export const listAccountsRoute = createRoute({
  method: "get",
  path: "/accounts",
  summary: "The account directory (Site administrator)",
  description:
    "Site administrators only: a Workspace administrator adds a person by exact address " +
    "and never browses or searches this list. Paged, ordered by address, filterable by " +
    "role and by status (active, unclaimed, disabled). It carries no credential and no " +
    "sign-in link.",
  tags,
  request: { query: AccountDirectoryQueryParams },
  responses: {
    200: {
      description: "One page of the directory",
      content: { "application/json": { schema: AccountListResponse } },
    },
    ...errorResponses(400, 401, 403),
  },
  ...withScopes("forms:read"),
});

export const createAccountRoute = createRoute({
  method: "post",
  path: "/accounts",
  summary: "Create an account by address (Site administrator)",
  description:
    "Creates an unclaimed account and emails it a single-use sign-in link that expires " +
    "after 72 hours. No response, screen or audit row shows the link or a password to " +
    "the administrator who asked for it. Refused while outbound email is not configured, " +
    "and refused where an account already holds that address.",
  tags,
  request: { body: jsonBody(CreateAccountBody) },
  responses: {
    201: {
      description: "The account just created, and what the relay did with the message",
      content: { "application/json": { schema: AccountCreatedResponse } },
    },
    ...errorResponses(400, 401, 403, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const resendSignInLinkRoute = createRoute({
  method: "post",
  path: "/accounts/{id}/sign-in-link",
  summary: "Send the account a fresh sign-in link (Site administrator)",
  description:
    "Issues a new single-use link and invalidates the one before it, so the account " +
    "holds exactly one usable link. Refused for a claimed account, which has no " +
    "creation link to resend, and for a disabled one, which is reactivated instead.",
  tags,
  request: { params: AccountIdParam },
  responses: {
    200: {
      description: "What the relay did with the message",
      content: { "application/json": { schema: SignInLinkResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const registerAccounts: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(listAccountsRoute, makeListAccountsHandler(deps));
  group.openapi(createAccountRoute, makeCreateAccountHandler(deps));
  group.openapi(resendSignInLinkRoute, makeResendSignInLinkHandler(deps));
};
