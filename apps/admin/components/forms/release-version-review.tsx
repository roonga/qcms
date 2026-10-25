"use client";

import { useEffect, useState } from "react";

import { Alert } from "@/components/kit";
import { VersionView } from "@/components/forms/version-view";
import type { FormVersionSnapshot } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import type { PreviewTheme } from "@/lib/preview-theme";
import type { ReadState } from "@/lib/read-state";

/** Load the selected immutable snapshot; a slower prior read cannot replace a newer one. */
export function ReleaseVersionReview({
  version,
  read,
  defaultTheme,
  onReady,
}: {
  readonly version: number;
  readonly read: (version: number) => Promise<ReadState<FormVersionSnapshot>>;
  readonly defaultTheme: PreviewTheme;
  readonly onReady: (version: number | undefined) => void;
}) {
  const [loaded, setLoaded] = useState<{
    version: number;
    result: ReadState<FormVersionSnapshot>;
  }>();
  useEffect(() => {
    let active = true;
    onReady(undefined);
    void read(version)
      .then((result) => {
        if (!active) return;
        if (result.ok && result.data.version !== version) {
          setLoaded({ version, result: { ok: false } });
          return;
        }
        setLoaded({ version, result });
        if (result.ok) onReady(version);
      })
      .catch(() => {
        if (active) setLoaded({ version, result: { ok: false } });
      });
    return () => {
      active = false;
    };
  }, [version, read, onReady]);

  if (loaded?.version !== version)
    return <p role="status">{t("forms.workflow.reviewLoading", { version })}</p>;
  if (!loaded.result.ok) return <Alert variant="error">{t("forms.workflow.reviewFailed")}</Alert>;
  return (
    <div data-testid="qcms-release-version-review">
      <h3 id="qcms-release-version-heading">{t("forms.workflow.reviewVersion", { version })}</h3>
      <VersionView
        snapshot={loaded.result.data}
        defaultTheme={defaultTheme}
        headingId="qcms-release-version-heading"
      />
    </div>
  );
}
