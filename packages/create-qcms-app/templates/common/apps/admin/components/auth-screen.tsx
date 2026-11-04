import type { ReactNode } from "react";

import { Alert, Card } from "@/components/kit";
import { t } from "@/lib/i18n/en";

export function AuthScreen({
  title,
  intro,
  error,
  children,
}: {
  readonly title: string;
  readonly intro?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-4"
    >
      <div className="qcms-card">
        <Card padding="lg" radius="md" border>
          <div className="flex flex-col gap-4">
            <h1 className="text-xl font-bold text-(--color-text)">{title}</h1>
            {intro !== undefined && <p className="text-sm text-(--color-text-muted)">{intro}</p>}
            {error !== undefined && (
              /* Autofocus only on a failed POST response, where the error alert cannot compete with initial field focus. */
              <div tabIndex={-1} autoFocus>
                <Alert variant="error">{error}</Alert>
              </div>
            )}
            {children}
          </div>
        </Card>
      </div>
      <p className="qcms-wordmark mt-5 text-center text-xs">{t("app.title")}</p>
    </main>
  );
}
