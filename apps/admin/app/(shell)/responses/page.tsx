import { redirect } from "next/navigation";

import { requireAdminSession } from "@/lib/server/session";
import { OPERATIONS_PATH } from "@/lib/shell/modes";

export default async function ResponsesPage() {
  await requireAdminSession();
  redirect(OPERATIONS_PATH);
}
