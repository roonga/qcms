import Link from "next/link";

import { t } from "@/lib/i18n/en";
import { formatList } from "@/lib/i18n/format";
import { MY_ACCESS_PATH } from "@/lib/shell/modes";

export interface NamedAccount {
  readonly name: string;
  readonly email: string;
}

/** The home of an account that holds nothing yet: who to ask, and a way to its own access. */
export function NoAccessHome({
  siteAdministrators,
  locale,
}: {
  readonly siteAdministrators: readonly NamedAccount[];
  readonly locale: string;
}) {
  const named = formatList(
    siteAdministrators.map((account) =>
      t("access.noAccess.person", { name: account.name, email: account.email }),
    ),
    locale,
  );
  const who =
    siteAdministrators.length === 0
      ? t("access.noAccess.administrator.none")
      : siteAdministrators.length === 1
        ? t("access.noAccess.administrator.one", { administrators: named })
        : t("access.noAccess.administrator.other", { administrators: named });

  return (
    <section
      aria-labelledby="qcms-no-access-heading"
      className="qcms-card flex max-w-prose flex-col gap-2 p-4"
      data-testid="qcms-no-access-home"
    >
      <h2 id="qcms-no-access-heading" className="text-base font-semibold text-(--color-text)">
        {t("access.noAccess.heading")}
      </h2>
      <p className="text-sm">{who}</p>
      <Link href={MY_ACCESS_PATH} className="qcms-text-link text-sm">
        {t("access.title")}
      </Link>
    </section>
  );
}
