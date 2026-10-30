import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The slot beside `/responses`, which redirects to the Operations forms table before
 * anything renders. It exists because every page route answers for one, and it names the
 * place the redirect goes.
 */
export default async function ResponsesRailSlot() {
  await requireAdminSession();
  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      title={t("shell.mode.operations.name")}
      testId="qcms-operations-rail"
    />
  );
}
