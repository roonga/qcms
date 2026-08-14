import { MessageScreen } from "@/components/message-screen";
import { t, type MessageKey } from "@/lib/i18n/en";

/**
 * Friendly typed error page for secure links (the BFF `/l/:token` handler
 * redirects here on LINK_EXPIRED / LINK_CONSUMED / LINK_REVOKED / LINK_INVALID).
 * No retry affordance (wireframe).
 */
interface ErrorCopy {
  readonly title: MessageKey;
  readonly body: MessageKey;
}

const INVALID: ErrorCopy = { title: "link.invalid.title", body: "link.invalid.body" };

const KIND_KEYS: Record<string, ErrorCopy> = {
  expired: { title: "link.expired.title", body: "link.expired.body" },
  consumed: { title: "link.consumed.title", body: "link.consumed.body" },
  revoked: { title: "link.revoked.title", body: "link.revoked.body" },
  invalid: INVALID,
  closed: { title: "formClosed.title", body: "formClosed.body" },
};

export default async function LinkErrorPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { kind } = await searchParams;
  const key = (typeof kind === "string" ? KIND_KEYS[kind] : undefined) ?? INVALID;
  return <MessageScreen tone="error" title={t(key.title)} body={t(key.body)} />;
}
