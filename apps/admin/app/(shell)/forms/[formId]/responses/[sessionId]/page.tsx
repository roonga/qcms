import { permanentRedirect } from "next/navigation";

import { operationalRedirect } from "@/lib/ops/moved-contexts";
import { requireAdminSession } from "@/lib/server/session";

/** One response's screen moved under Operations; the old address still arrives. */
export default async function MovedFormResponsePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formId: string; sessionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const { formId, sessionId } = await params;
  permanentRedirect(
    operationalRedirect(
      formId,
      "responses",
      await searchParams,
      `/${encodeURIComponent(sessionId)}`,
    ),
  );
}
