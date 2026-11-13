export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * `undeliverable` covers every transport outcome, a refused recipient included, so a caller
 * cannot learn from the failure whether an address exists.
 */
export type MailFailure = "not-configured" | "undeliverable";

export type MailResult =
  { readonly ok: true } | { readonly ok: false; readonly failure: MailFailure };

export interface Mailer {
  /** The check account creation and reactivation read before promising an emailed link. */
  readonly configured: boolean;
  send(message: MailMessage): Promise<MailResult>;
}

export const unconfiguredMailer: Mailer = {
  configured: false,
  send: () => Promise.resolve({ ok: false, failure: "not-configured" }),
};
