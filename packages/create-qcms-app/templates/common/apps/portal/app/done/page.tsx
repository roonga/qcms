import { CompletionView } from "@/components/completion-view";
import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { readReceiptCookie } from "@/lib/server/route-helpers";

export default async function CompletionPage() {
  const receipt = await readReceiptCookie();
  if (receipt === undefined) {
    return (
      <MessageScreen tone="success" title={t("completion.title")} body={t("completion.body")} />
    );
  }
  return <CompletionView submittedAt={receipt.submittedAt} contentHash={receipt.contentHash} />;
}
