"use client";

import { useCallback, useEffect, useId, useState } from "react";

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
/** How long the tick stands before the control goes back to offering the copy. */
const COPIED_MS = 2000;

export function PublicFormLink({
  url,
  isClosed,
}: {
  readonly url: string;
  /** A closed form keeps its address; what changes is what a respondent gets at it. */
  readonly isClosed: boolean;
}) {
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  // Shut by default, which is the whole point: the paragraph is a standing explanation
  // that never changes, and it was taking four lines under every published form to say so.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();

  // Back to the copy icon after a moment, because the tick is feedback about a gesture
  // rather than a state the control is in: a button that stays ticked says "this link is
  // on the clipboard", which stops being true as soon as anything else copies anything.
  // The cleanup matters as much as the timer - leaving this screen while it runs would
  // otherwise set state on an unmounted component.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setNote(t("forms.links.copied"));
      })
      .catch(() => {
        // The icon does NOT change on a refusal. A tick would say the address is on the
        // clipboard when it is not, which is the one thing this control must never say.
        setCopied(false);
        setNote(t("forms.links.copyFailed"));
      });
  }, [url]);

  return (
    <section
      aria-labelledby="qcms-public-link-heading"
      className="flex flex-col gap-2 rounded-md border border-(--color-border) p-4"
      data-testid="qcms-public-form-link-block"
    >
      {/* ONE ROW: the label, the address it labels, and the two small controls that act
          on it. It was three stacked rows for what is a single fact, and the label above
          the value made the block read as a section rather than as a field. `flex-wrap`
          is what keeps that honest at a narrow width - the address is the long part, so
          it takes the second line rather than being truncated. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2
          id="qcms-public-link-heading"
          className="flex-shrink-0 text-base font-semibold text-(--color-text)"
        >
          {t("forms.publicLink.heading")}
        </h2>
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
          // THE NAME DOES NOT CHANGE WITH THE ICON. Pressing it still copies - that is
          // what a second press does - and renaming a focused control under a screen
          // reader mid-interaction is a worse trade than the redundancy. A screen reader
          // gets the live region below instead, which says the copy happened; the tick is
          // that same statement for everyone else.
          aria-label={t("forms.publicLink.copy")}
          data-copied={copied ? "" : undefined}
          onClick={copy}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {copied ? (
              <path d="M20 6 9 17l-5-5" />
            ) : (
              <>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </>
            )}
          </svg>
        </button>
        {/* A DISCLOSURE, not a tooltip. What it holds is a paragraph explaining what this
            address is and what it is not, which is too long to hover over and is exactly
            the thing a keyboard or touch reader loses when it is a tooltip.
            `aria-expanded` and `aria-controls` are what make the button say which it is.

            Rendered in flow rather than floated over the screen on purpose: an absolutely
            positioned panel inside a scrolling column is what produced the clipped
            row-menu popover this app already fixed once, and there is nothing here that
            needs to overlap anything. */}
        <button
          type="button"
          className="qcms-help-dot"
          aria-expanded={helpOpen}
          aria-controls={helpId}
          aria-label={t("forms.publicLink.helpLabel")}
          onClick={() => {
            setHelpOpen((open) => !open);
          }}
        >
          <span aria-hidden="true">{"?"}</span>
        </button>
      </div>
      {helpOpen && (
        <p id={helpId} className="text-sm text-(--color-text-muted)">
          {t(isClosed ? "forms.publicLink.hintClosed" : "forms.publicLink.hintOpen")}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-(--color-text-muted)">
        {note}
      </p>
    </section>
  );
}
