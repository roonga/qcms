"use client";

import { useOperatorDayFormat } from "@/components/operator-time";
import type { FormListItem } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The forms list's Version column: what respondents are seeing, and when it was frozen.
 *
 * Its own module, and the only `"use client"` boundary the forms list has, because the day
 * lands INSIDE a catalog sentence ("v3, frozen 2 Aug 2026") rather than in an element of
 * its own. A component has nowhere to hang there, so this reads the formatter from
 * `useOperatorDayFormat` and passes a string into `t(...)` - the same shape
 * `components/ops/delivery-dashboard.tsx` uses for its redaction sentence.
 *
 * The alternative was to mark the whole table `"use client"` for one cell. That would move
 * a static table of anchors into the client bundle to answer a question one cell asks, and
 * the boundary belongs where the hydration swap is rather than around everything near it.
 *
 * `FormsTable` stays a server component, so the row anchors and every other cell are server
 * markup exactly as they were.
 */
export function PublishedCell({ form }: { readonly form: FormListItem }) {
  // Pinned UTC for the server render and the first client render, the operator's own zone
  // after hydration (issue #582; `components/operator-time.tsx` states why that is safe).
  const formatDay = useOperatorDayFormat();
  if (form.latestVersion === null) return <>{t("forms.version.none")}</>;
  if (form.publishedAt === null) {
    return <>{t("forms.version.value", { version: form.latestVersion })}</>;
  }
  return (
    <>
      {t("forms.version.valueAt", {
        version: form.latestVersion,
        date: formatDay(form.publishedAt),
      })}
    </>
  );
}
