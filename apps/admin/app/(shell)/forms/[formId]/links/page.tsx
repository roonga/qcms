import { permanentRedirect } from "next/navigation";

import { operationalRedirect } from "@/lib/ops/moved-contexts";
import { requireAdminSession } from "@/lib/server/session";

/** The secure-links screen moved under Operations; the old address still arrives. */
export default async function MovedFormLinksPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const { formId } = await params;
  permanentRedirect(operationalRedirect(formId, "links", await searchParams));
}
