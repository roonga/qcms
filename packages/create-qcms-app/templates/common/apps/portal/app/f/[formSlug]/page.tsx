import { EntryView } from "@/components/entry-view";
import { MessageScreen } from "@/components/message-screen";
import { t, type MessageKey } from "@/lib/i18n/en";

// A neutral invitation rather than form metadata: the API is internal and has no
// unauthenticated form-meta endpoint (R2).
const STATE_KEYS: Record<string, { title: MessageKey; body: MessageKey }> = {
  closed: { title: "formClosed.title", body: "formClosed.body" },
  notfound: { title: "formUnavailable.title", body: "formUnavailable.body" },
  error: { title: "formUnavailable.title", body: "formUnavailable.body" },
};

export default async function AnonymousEntryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { formSlug } = await params;
  const { state } = await searchParams;

  const problem = typeof state === "string" ? STATE_KEYS[state] : undefined;
  if (problem !== undefined) {
    return <MessageScreen tone="neutral" title={t(problem.title)} body={t(problem.body)} />;
  }

  return <EntryView title={t("entry.title")} startAction={`/f/${formSlug}/start`} />;
}
