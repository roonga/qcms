import { redirect } from "next/navigation";

import { requireAdminSession } from "@/lib/server/session";
import { OPERATIONS_PATH } from "@/lib/shell/modes";

/**
 * The legacy responses picker, which the Operations forms table replaces.
 *
 * A redirect rather than a deletion: the address is in bookmarks and in existing
 * documentation, and a 404 would strand whoever holds one. It produces no document, so it
 * names no browser tab.
 */
export default async function ResponsesPage() {
  await requireAdminSession();
  redirect(OPERATIONS_PATH);
}
