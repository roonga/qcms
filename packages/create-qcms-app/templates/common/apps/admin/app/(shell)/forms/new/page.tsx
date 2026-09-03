import Link from "next/link";
import type { Metadata } from "next";

import { Card } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { requireAdminSession } from "@/lib/server/session";

import { createFormAction } from "../actions";
import { CreateForm } from "./create-form";

/** The browser-tab title for this route (issue #536). */
export function generateMetadata(): Metadata {
  return pageMetadata(t("forms.create.title"));
}

/**
 * Creating a form (issue 685; the affordance itself is task 033's, moved).
 *
 * `plan/admin-shell-poc/library-lists-poc.html` chooses one creation pattern for both
 * library screens - a separate route named "New question" / "New form" - and names the
 * forms list's inline create card as the screen that should change to match it. This is
 * that screen, built to the model the POC points at rather than to a second answer:
 * `/questions/new` is the shipped example, and this file is deliberately its shape (back
 * link, the screen's own `h1`, one card holding the form).
 *
 * No POC draws this screen on its own. The drawing that decides it decides the PATTERN and
 * names its model, and `settings-newquestion-poc.html` is where that model is drawn, so
 * the shape and the 40rem measure both come from there (`lib/measure.ts`).
 *
 * The form posts to `createFormAction`, which has not changed: what moved is where an
 * author is standing when they use it, not what happens when they do.
 *
 * `requireAdminSession()` is called even though the `(shell)` layout already did: this
 * page reads nothing from the session, but calling it keeps the guarantee local to the
 * file rather than inherited from a layout someone could later move the route out of. The
 * same sentence `/questions/new` carries, for the same reason.
 */
export default async function NewFormPage() {
  await requireAdminSession();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/forms" className="qcms-text-link">
          {t("forms.backToList")}
        </Link>
        <h1 className="text-xl font-semibold text-(--color-text)">{t("forms.create.title")}</h1>
      </div>
      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          <CreateForm action={createFormAction} />
        </Card>
      </div>
    </div>
  );
}
