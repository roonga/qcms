import type { ReactNode } from "react";

import { Alert, Card } from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * The shared frame for every unauthenticated screen (task 031): sign-in, 2FA
 * enrollment, the recovery-code display, the 2FA challenge, and recovery-code
 * entry. The signed wireframe specifies a `card` for each, so they share one.
 *
 * `error` renders the generic failure `alert`, which the wireframe's a11y notes require
 * to **receive focus**. It does so with `autoFocus` on a `tabIndex={-1}` wrapper rather
 * than an effect: the alert is present in the server-rendered HTML on the very first
 * paint after a failed POST (these screens are form posts, not client fetches), so the
 * browser places focus during parsing and the behaviour does not depend on hydration.
 *
 * The wrapper carries **no `role`**, deliberately. The vendored `Alert` already renders
 * `role="alert"`, and adding a second one here produced two alert-role elements for one
 * message - caught by the e2e suite as a strict-mode locator violation, and it would have
 * been announced twice by a screen reader. The wrapper's only job is focus.
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
    <main
      id="admin-main"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-4"
    >
      {/* `qcms-card` carries the app's layered shadow. The vendored `Card` takes no
          className (ADR-22: it is the component, not a QCMS variant of it), so the
          chrome the theme adds rides on the element around it. */}
      <div className="qcms-card">
        <Card padding="lg" radius="md" border>
          <div className="flex flex-col gap-4">
            <h1 className="text-xl font-bold text-(--color-text)">{title}</h1>
            {intro !== undefined && <p className="text-sm text-(--color-text-muted)">{intro}</p>}
            {error !== undefined && (
              /* `autoFocus` is required by the wireframe's a11y notes ("sign-in error
                 alert receives focus") and is safe here specifically because this
                 element only exists on the response to a failed POST: it is never
                 competing with another control for initial focus. */
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
