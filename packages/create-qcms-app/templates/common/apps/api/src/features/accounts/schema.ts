import { z } from "@hono/zod-openapi";

export const ACCOUNT_STATUSES = ["active", "unclaimed", "disabled"] as const;

export const ACCOUNT_ROLES = ["site-administrator", "member"] as const;

export const AccountIdParam = z.object({
  id: z.string().min(1).openapi({ param: { name: "id", in: "path" }, example: "usr_7m2" }),
});

export const AccountDirectoryQueryParams = z.object({
  q: z
    .string()
    .optional()
    .openapi({ param: { name: "q", in: "query" }, example: "ada@" }),
  role: z
    .enum(ACCOUNT_ROLES)
    .optional()
    .openapi({ param: { name: "role", in: "query" } }),
  status: z
    .enum(ACCOUNT_STATUSES)
    .optional()
    .openapi({ param: { name: "status", in: "query" } }),
  page: z.string().optional().openapi({ param: { name: "page", in: "query" } }),
  pageSize: z.string().optional().openapi({ param: { name: "pageSize", in: "query" } }),
});

export const CreateAccountBody = z
  .strictObject({
    email: z.email().max(254).openapi({ example: "ada@example.test" }),
    /** The display name the audit and the member lists show; the address when absent. */
    name: z.string().trim().min(1).max(120).optional().openapi({ example: "Ada Lovelace" }),
  })
  .openapi("CreateAccountBody");

export const AccountView = z
  .object({
    userId: z.string().openapi({ example: "usr_7m2" }),
    email: z.email().openapi({ example: "ada@example.test" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    role: z.enum(ACCOUNT_ROLES),
    status: z.enum(ACCOUNT_STATUSES),
    createdAt: z.iso.datetime(),
    claimedAt: z.iso.datetime().nullable(),
    disabledAt: z.iso.datetime().nullable(),
  })
  .openapi("AccountView");

export const AccountListResponse = z
  .object({
    accounts: z.array(AccountView),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .openapi("AccountListResponse");

/**
 * What the relay did with the message. The link itself never appears in a response or a
 * log: the administrator who created the account cannot read it.
 */
export const SignInLinkDeliveryView = z
  .enum(["sent", "undeliverable"])
  .openapi("SignInLinkDelivery");

export const AccountCreatedResponse = z
  .object({ account: AccountView, delivery: SignInLinkDeliveryView })
  .openapi("AccountCreatedResponse");

export const SignInLinkResponse = z
  .object({ delivery: SignInLinkDeliveryView })
  .openapi("SignInLinkResponse");
