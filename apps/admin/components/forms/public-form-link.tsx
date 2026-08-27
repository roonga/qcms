"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * A published form's own address on the respondent portal, with a copy control.
 *
 * `plan/admin-shell-poc/responses-poc.html` draws this block and writes its reasoning at
 * length: it is "the form's own standing address for as long as it stays published and
 * open", and it is "deliberately separate from a minted secure link (the Links tab)"
 * because a secure link is a one-time or expiring invitation that the API cannot show
 * again. The label, the `<code>` treatment, the Copy button and the hint below all come
 * from that drawing rather than from an invention here.
 *
 * The POC puts it on the Responses screen, on the reasoning that an operator looking at
 * responses is the one most likely to need to hand it out. It is on the FORM's own screen
 * as well (Code Owner, 2026-08-26), which the same comment anticipates when it says
 * "placed here rather than ONLY on the Form/Links tabs".
 *
 * ## Why the copy note is not an alert
 *
 * `aria-live="polite"` on a line that starts empty, which is the shape `secure-links.tsx`
 * already uses for the same gesture on the same kind of value. A copy either worked or it
 * did not, and neither outcome is an error the screen has to interrupt anyone about -
 * `navigator.clipboard` is refused often enough (an insecure origin, a denied permission)
 * that a failure is a normal thing to say quietly.
 */
export function PublicFormLink({
  url,
  isClosed,
}: {
  readonly url: string;
  /** A closed form keeps its address; what changes is what a respondent gets at it. */
  readonly isClosed: boolean;
}) {
  const [note, setNote] = useState("");

  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setNote(t("forms.links.copied"));
      })
      .catch(() => {
        setNote(t("forms.links.copyFailed"));
      });
  }, [url]);

  return (
    <section
      aria-labelledby="qcms-public-link-heading"
      className="flex flex-col gap-2 rounded-md border border-(--color-border) p-4"
      data-testid="qcms-public-form-link-block"
    >
      <h2 id="qcms-public-link-heading" className="text-base font-semibold text-(--color-text)">
        {t("forms.publicLink.heading")}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {/* A `<code>` because it is a literal string to be copied exactly, and selectable
            because the Copy button is a convenience rather than the only way out: a
            clipboard write can be refused, and a reader who cannot use it must still be
            able to select the address by hand. */}
        <code
          className="qcms-link-url"
          data-testid="qcms-public-form-link"
          data-form-closed={isClosed ? "" : undefined}
        >
          {url}
        </code>
        <Button variant="ghost" size="sm" onPress={copy}>
          {t("forms.publicLink.copy")}
        </Button>
      </div>
      <p className="text-sm text-(--color-text-muted)">
        {t(isClosed ? "forms.publicLink.hintClosed" : "forms.publicLink.hintOpen")}
      </p>
      <p aria-live="polite" className="text-sm text-(--color-text-muted)">
        {note}
      </p>
    </section>
  );
}
