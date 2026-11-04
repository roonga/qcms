"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { t } from "@/lib/i18n/en";

const COPIED_MS = 2000;

export function PublicFormLink({
  url,
  isClosed,
}: {
  readonly url: string;
  readonly isClosed: boolean;
}) {
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();

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
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(() => {
        setCopied(true);
        setNote(t("forms.links.copied"));
      })
      .catch(() => {
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2
          id="qcms-public-link-heading"
          className="flex-shrink-0 text-base font-semibold text-(--color-text)"
        >
          {t("forms.publicLink.heading")}
        </h2>
        {/* Use noopener on the new-tab public link so the opened page cannot control this authoring tab through
   window.opener. */}
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
        <button
          type="button"
          className="qcms-copyid"
          data-readonly-action="copy"
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
