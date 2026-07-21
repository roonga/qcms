import { CompletionView } from "@/components/completion-view";
import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { readReceiptCookie } from "@/lib/server/route-helpers";

/**
 * Completion (`/done`). The submit route stored the receipt (submittedAt +
 * contentHash) in a short-lived httpOnly cookie; this page reads it and renders
 * the receipt. A direct visit without a receipt (e.g. cookie expired, page
 * revisited) shows the neutral thank-you without the reference.
 */
export default async function CompletionPage() {
  const receipt = await readReceiptCookie();
  if (receipt === undefined) {
    return (
      <MessageScreen tone="success" title={t("completion.title")} body={t("completion.body")} />
    );
  }
  return <CompletionView submittedAt={receipt.submittedAt} contentHash={receipt.contentHash} />;
}
