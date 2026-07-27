import type { ReactNode } from "react";

import { Alert, Card } from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * The shared frame for every unauthenticated screen (task 031): sign-in, 2FA
 * enrollment, the recovery-code display, the 2FA challenge, and recovery-code
 * entry. The signed wireframe specifies a `card` for each, so they share one.
 *
 * `error` renders the generic failure `alert`, which the wireframe's a11y notes
 * require to **receive focus**. It does so with `autoFocus` on a `tabIndex={-1}`
 * container rather than an effect: the alert is present in the server-rendered HTML
 * on the very first paint after a failed POST (these screens are form posts, not
 * client fetches), so the browser can place focus during parsing and the behaviour
 * does not depend on hydration. `role="alert"` on the same element is what makes a
 * screen reader announce it.
 */
export function AuthScreen({
  title,
  intro,
  error,
  children,
}: {
  readonly title: string;
  readonly intro?: string | undefined;
  /** The generic failure sentence, or `undefined` for no failure state. */
  readonly error?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <main id="admin-main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-4">
      <Card padding="lg" radius="md" border>
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-(--color-text)">{title}</h1>
          {intro !== undefined && <p className="text-sm text-(--color-text-muted)">{intro}</p>}
          {error !== undefined && (
            /* `autoFocus` is required by the wireframe's a11y notes ("sign-in error
               alert receives focus") and is safe here specifically because this
               element only exists on the response to a failed POST: it is never
               competing with another control for initial focus. */
            <div role="alert" tabIndex={-1} autoFocus>
              <Alert variant="error">{error}</Alert>
            </div>
          )}
          {children}
        </div>
      </Card>
      <p className="mt-4 text-center text-xs text-(--color-text-muted)">{t("app.title")}</p>
    </main>
  );
}
