"use client";

import { useCallback, useState } from "react";

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
        {/* AN ANCHOR, because following it is the point: this is the respondent's view of
            the author's own form, and being able to open it is how an author checks that
            what they published is what they meant. `docs/admin-constraints.md` - an anchor
            navigates, a button acts - and this navigates.

            A new tab, and `rel` with it. The author is mid-edit on a draft this screen
            autosaves, so taking the tab away to show them the respondent's side would cost
            them their place; `noopener` is not optional on a `_blank` link, because
            without it the opened page gets a handle on this one through `window.opener`.

            Still a `<code>` inside it: the string is a literal to be copied exactly, and
            it stays selectable by hand, because a clipboard write can be refused (an
            insecure origin, a denied permission) and the icon must not be the only way
            out. */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="qcms-public-link__url"
          data-testid="qcms-public-form-link"
          data-form-closed={isClosed ? "" : undefined}
        >
          <code className="qcms-link-url">{url}</code>
          <span className="qcms-visually-hidden">{t("forms.publicLink.opensNewTab")}</span>
        </a>
        {/* THE SAME CONTROL THE PIN GRID ALREADY HAS for copying an id
            (`step-editor.tsx`'s `CopyQuestionId`), down to the class and the icon: one
            gesture, one shape, one set of styles. A bare `<button>` rather than the kit's,
            because the kit's takes no `aria-label` - a closed API - and an icon button
            needs one. Its 24px box is deliberately under the app's 40px control minimum:
            it sits inside a row that is already a target, and it is never the only way to
            the value, which is the same argument written out at `CopyQuestionId`. */}
        <button
          type="button"
          className="qcms-copyid"
          data-readonly-action="copy"
          aria-label={t("forms.publicLink.copy")}
          onClick={copy}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </button>
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
