import { permanentRedirect } from "next/navigation";

import { operationalRedirect } from "@/lib/ops/moved-contexts";
import { requireAdminSession } from "@/lib/server/session";

/**
 * A redirect rather than a deletion: the address is in bookmarks, in release outcomes and
 * in existing documentation, and a 404 would strand whoever holds one. It produces no
 * document, so it names no browser tab.
 */
export default async function MovedFormResponsesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const { formId } = await params;
  permanentRedirect(operationalRedirect(formId, "responses", await searchParams));
}
