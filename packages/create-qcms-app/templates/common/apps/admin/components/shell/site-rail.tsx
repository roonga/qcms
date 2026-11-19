import { RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { SHARED_LIBRARY_PATH } from "@/lib/membership/site";

/**
 * Site configuration's rail. This task adds its own row only; the area's other rows arrive
 * with their screens. The row is drawn at two or more workspaces and hidden at one
 * (`docs/WORKSPACE_ACCESS.md` section 9).
 */
export function SiteRail({
  current,
  offersLibrary,
}: {
  readonly current: "shared-library";
  readonly offersLibrary: boolean;
}) {
  if (!offersLibrary) return <RailFrame subject={t("site.title")} testId="qcms-site-rail" />;
  return (
    <RailFrame
      subject={t("site.title")}
      testId="qcms-site-rail"
      sections={
        <RailTree
          items={[
            {
              key: "section:shared-library",
              href: SHARED_LIBRARY_PATH,
              label: t("site.library.title"),
              current: current === "shared-library",
            },
          ]}
        />
      }
    />
  );
}
