import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeAccountHoldingsHandler,
  makeDisableAccountHandler,
  makeReactivateAccountHandler,
  makeResetAccountHandler,
} from "./lifecycle.js";
import {
  makeCreateAccountHandler,
  makeListAccountsHandler,
  makeResendSignInLinkHandler,
} from "./handler.js";
import {
  AccountCreatedResponse,
  AccountDirectoryQueryParams,
  AccountDisabledResponse,
  AccountHoldingsResponse,
  AccountIdParam,
  AccountLinkSentResponse,
  AccountListResponse,
  CreateAccountBody,
  ResetAccountBody,
  SignInLinkResponse,
} from "./schema.js";

import { HeldResponse } from "../site-admins/schema.js";

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
    "Issues a new single-use link and invalidates every live one before it under the " +
    "account's own lock, so the account holds exactly one usable link however many " +
    "resends run at once, and completing the claim invalidates that one too. The link " +
    "keeps the purpose of the one it replaces, so a reset or reactivation link is never " +
    "resent as a creation link. Refused for a claimed account, which has no link to " +
    "resend, and for a disabled one, which is reactivated instead.",
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

export const accountHoldingsRoute = createRoute({
  method: "get",
  path: "/accounts/{id}/holdings",
  summary: "What an account holds across every workspace (Site administrator)",
  description:
    "For the disable confirmation: every access group the account holds, those carrying " +
    "a response role, and the workspaces it is a Workspace administrator of, marking " +
    "those where it is the last active one. Disabling still proceeds in those.",
  tags,
  request: { params: AccountIdParam },
  responses: {
    200: {
      description: "The account's holdings",
      content: { "application/json": { schema: AccountHoldingsResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const disableAccountRoute = createRoute({
  method: "post",
  path: "/accounts/{id}/disable",
  summary: "Disable an account (Site administrator)",
  description:
    "Succeeds at once. In one transaction: the account is marked disabled, loses any Site " +
    "administrator role, every session it holds is deleted and every live sign-in link " +
    "dies. Memberships are kept. One site-audit row, mirrored to every workspace the " +
    "account holds something in. Refused for your own account and for the last active " +
    "Site administrator. Disabling a Site administrator needs a step-up on this session " +
    "and is held as a site approval request while an active, claimed Site administrator " +
    "other than you and the target exists. No route deletes an account.",
  tags,
  request: { params: AccountIdParam },
  responses: {
    200: {
      description: "The disabled account, and what it held when it was disabled",
      content: { "application/json": { schema: AccountDisabledResponse } },
    },
    202: {
      description: "Held as a site approval request until another Site administrator approves it",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const reactivateAccountRoute = createRoute({
  method: "post",
  path: "/accounts/{id}/reactivate",
  summary: "Reactivate a disabled account (Site administrator)",
  description:
    "Clears the disabled flag and takes away the password and second factor, then emails " +
    "a single-use link through which the person sets a new password and enrols a new " +
    "factor; until then the account holds nothing. Memberships of groups carrying a " +
    "response role stay suspended until re-confirmed; the others return once the person " +
    "signs in. A former Site administrator is not one again.",
  tags,
  request: { params: AccountIdParam },
  responses: {
    200: {
      description: "The account, and what the relay did with the message",
      content: { "application/json": { schema: AccountLinkSentResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const resetAccountRoute = createRoute({
  method: "post",
  path: "/accounts/{id}/reset",
  summary: "Reset an account's password or second factor (Site administrator)",
  description:
    "In one transaction every session is deleted, memberships of groups carrying a " +
    "response role are suspended until re-confirmed, and the account holds nothing until " +
    "the person signs in again through the emailed single-use link. After a password " +
    "reset they set a new password; after a factor reset they sign in with the password " +
    "they have and enrol a new factor. Refused for your own account, a disabled one, one " +
    "never claimed and the last active Site administrator. Resetting a Site administrator " +
    "needs a step-up and a second Site administrator's approval, as disabling one does.",
  tags,
  request: { params: AccountIdParam, body: jsonBody(ResetAccountBody) },
  responses: {
    200: {
      description: "The account, and what the relay did with the message",
      content: { "application/json": { schema: AccountLinkSentResponse } },
    },
    202: {
      description: "Held as a site approval request until another Site administrator approves it",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const registerAccounts: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(listAccountsRoute, makeListAccountsHandler(deps));
  group.openapi(createAccountRoute, makeCreateAccountHandler(deps));
  group.openapi(resendSignInLinkRoute, makeResendSignInLinkHandler(deps));
  group.openapi(accountHoldingsRoute, makeAccountHoldingsHandler(deps));
  group.openapi(disableAccountRoute, makeDisableAccountHandler(deps));
  group.openapi(reactivateAccountRoute, makeReactivateAccountHandler(deps));
  group.openapi(resetAccountRoute, makeResetAccountHandler(deps));
};
