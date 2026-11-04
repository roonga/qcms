import { Suspense } from "react";
import type { Metadata } from "next";

import { OperationsLoading, OperationsScreen } from "@/components/ops/operations-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return pageMetadata(t("shell.mode.operations.name"));
}

/* The loading boundary is here rather than in a `loading.tsx` beside this page, because that
   file wraps every `/operations/**` screen as well: the shell flushes before a nested page
   runs, and a `notFound()` below it then arrives as 200. */
export default function OperationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<OperationsLoading />}>
      <OperationsScreen searchParams={searchParams} />
    </Suspense>
  );
}
