import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The authenticated shell (task 031; wireframe "ASCII sketch - authenticated shell").
 *
 * This layout is the authentication gate for every **page** tasks 032-035 add: a page
 * placed in this route group is behind `requireAdminSession()` by construction, so a
 * new area cannot ship accidentally public. Auth screens sit outside the group, which
 * is why they are unaffected by it.
 *
 * It does **not** cover a `route.ts` in the group: a Next layout wraps the page tree
 * and never runs for a route handler. A route handler under here guards itself, and
 * `settings/password/route.ts` currently does not (issue #177) - it fails closed on
 * authentication via better-auth, but skips the absolute-lifetime and 2FA-enrollment
 * gates that `requireAdminSession()` adds.
 *
 * Sign-out is a form POST rather than a link, because signing out is a state change
 * and a GET link would let a prefetch or a crawler end someone's session. It is the
 * same reason the auth screens post: no client JavaScript is involved in any
 * credential or session transition here.
 */
export default async function ShellLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireAdminSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-(--color-border) bg-(--color-surface)">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-semibold tracking-tight text-(--color-text)">
              {t("app.title")}
            </span>
            <AdminNav />
          </div>
          <form method="post" action="/sign-out">
            <Button type="submit" variant="ghost" size="sm">
              {t("action.signOut")}
            </Button>
          </form>
        </div>
      </header>
      <main id="admin-main" className="mx-auto w-full max-w-5xl flex-1 p-4">
        {children}
      </main>
      {/* The email is shell chrome, not a credential; it tells an operator which
          account is acting when several people share a screen. */}
      <footer className="mx-auto w-full max-w-5xl p-4 text-xs text-(--color-text-muted)">
        {t("settings.signedInAs", { email: session.email })}
      </footer>
    </div>
  );
}
