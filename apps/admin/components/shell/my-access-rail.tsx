import { RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { MY_ACCESS_PATH } from "@/lib/shell/modes";

export function MyAccessRail() {
  return (
    <RailFrame
      subject={t("access.title")}
      testId="qcms-my-access-rail"
      sections={
        <RailTree
          items={[
            {
              key: "section:my-access",
              href: MY_ACCESS_PATH,
              label: t("access.title"),
              current: true,
            },
          ]}
        />
      }
    />
  );
}
