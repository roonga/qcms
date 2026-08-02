"use client";

import { useCallback, useState, useTransition } from "react";

import { Alert, Button, Checkbox, DatePicker, Dialog, NumberField } from "@/components/kit";
import { LinkStateTag } from "@/components/forms/link-state-tag";
import type { MintLinksState, RevokeLinkState } from "@/lib/forms/builder-state";
import { IDLE_MINT, IDLE_REVOKE } from "@/lib/forms/builder-state";
import { isRevocable, mintedLinksCsv, mintedLinksFilename } from "@/lib/forms/links";
import type { MintedLink, SecureLink } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The secure-link screen: mint, list, copy, export, revoke (task 034; wireframe "secure
 * links").
 *
 * ## Why the minted URLs are their own state and not a table column
 *
 * A link's token exists in exactly one response. The API stores a `secure_links` state row
 * and never the token itself, so a URL that is not copied out of the mint result cannot be
 * recovered - not by reloading, not by an admin, not by the operator. The screen is shaped
 * around that fact rather than hiding it: minting opens a result panel that says so, with
 * copy buttons and a CSV export on it, and the lifecycle table below shows state and never
 * URLs.
 *
 * That is also why the CSV is assembled client-side from the mint result. An export built
 * from the links list could not contain a single usable URL.
 *
 * ## Revoking is a confirmation, and R1 is in it
 *
 * Revoke is one-way and immediate, so the dialog states the consequence rather than asking
 * for certainty - and it says what does *not* happen: a session already started with the
 * link finishes normally, because a session pins its version and its own progress.
 *
 * The wireframe names a `switch` for the one-time control. The vendored a2ra set has no
 * Switch, and hand-writing one is exactly what ADR-22 forbids, so this uses the vendored
 * `Checkbox` - the same substitution `form-settings-panel.tsx` makes for its booleans. A
 * real Switch would be a COMPONENT_GUIDELINES vendoring in its own right.
 */
export function SecureLinks({
  formId,
  links,
  canMint,
  maxBatch,
  mint,
  revoke,
}: {
  readonly formId: string;
  readonly links: readonly SecureLink[];
  /** Links open the newest published version, so a never-published form cannot mint. */
  readonly canMint: boolean;
  readonly maxBatch: number;
  readonly mint: (request: {
    readonly expiresAt: string;
    readonly oneTime: boolean;
    readonly count: number;
  }) => Promise<MintLinksState>;
  readonly revoke: (linkId: string) => Promise<RevokeLinkState>;
}) {
  const [dialog, setDialog] = useState<"mint" | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintLinksState>(IDLE_MINT);
  const [revoked, setRevoked] = useState<RevokeLinkState>(IDLE_REVOKE);
  const [copyNote, setCopyNote] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const [expiresAt, setExpiresAt] = useState<string>("");
  const [oneTime, setOneTime] = useState(false);
  const [count, setCount] = useState(1);

  const runMint = useCallback(() => {
    startTransition(() => {
      void mint({ expiresAt, oneTime, count }).then((state) => {
        setMinted(state);
        if (state.status === "minted") setDialog(null);
      });
    });
  }, [mint, expiresAt, oneTime, count]);

  const runRevoke = useCallback(
    (linkId: string) => {
      startTransition(() => {
        void revoke(linkId).then((state) => {
          setRevoked(state);
          if (state.status === "revoked") setRevoking(null);
        });
      });
    },
    [revoke],
  );

  const copy = useCallback((url: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopyNote(t("forms.links.copied"));
      })
      .catch(() => {
        setCopyNote(t("forms.links.copyFailed"));
      });
  }, []);

  return (
    <section
      aria-labelledby="qcms-links-heading"
      className="flex flex-col gap-4"
      data-testid="qcms-secure-links"
    >
      <div className="flex flex-col gap-1">
        <h2 id="qcms-links-heading" className="text-lg font-semibold text-(--color-text)">
          {t("forms.links.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("forms.links.intro")}</p>
      </div>

      {canMint ? (
        <div>
          <Button
            variant="primary"
            size="md"
            isDisabled={isPending}
            onPress={() => {
              setMinted(IDLE_MINT);
              setDialog("mint");
            }}
          >
            {t("forms.links.mint")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-links-needs-publish">
          {t("forms.links.needsPublish")}
        </p>
      )}

      <div aria-live="polite" className="flex flex-col gap-2">
        {minted.status === "error" && (
          <Alert variant="error">
            {t("forms.links.mintFailed", { message: minted.message ?? "" })}
          </Alert>
        )}
        {revoked.status === "revoked" && (
          <Alert variant="success">{t("forms.links.revoked")}</Alert>
        )}
        {revoked.status === "error" && (
          <Alert variant="error">
            {t("forms.links.revokeFailed", { message: revoked.message ?? "" })}
          </Alert>
        )}
        {copyNote !== "" && <p className="text-sm text-(--color-text-muted)">{copyNote}</p>}
      </div>

      {minted.status === "minted" && minted.links !== undefined && (
        <MintedPanel
          formId={formId}
          links={minted.links}
          onCopy={copy}
          onDismiss={() => {
            setMinted(IDLE_MINT);
          }}
        />
      )}

      <LinksTable
        links={links}
        onRevoke={(linkId) => {
          setRevoked(IDLE_REVOKE);
          setRevoking(linkId);
        }}
        isPending={isPending}
      />

      {dialog === "mint" && (
        <Dialog
          isOpen
          title={t("forms.links.mintTitle")}
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDialog(null);
          }}
        >
          <div className="flex flex-col gap-4">
            <DatePicker
              label={t("forms.links.expiresAt")}
              description={t("forms.links.expiresAtHint")}
              granularity="day"
              value={expiresAt}
              onChange={setExpiresAt}
            />
            <Checkbox label={t("forms.links.oneTime")} isSelected={oneTime} onChange={setOneTime} />
            <NumberField
              label={t("forms.links.count")}
              description={t("forms.links.countHint", { max: maxBatch })}
              minValue={1}
              maxValue={maxBatch}
              step={1}
              value={count}
              onChange={setCount}
            />
            {minted.status === "error" && (
              <Alert variant="error">
                {t("forms.links.mintFailed", { message: minted.message ?? "" })}
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="md"
                isDisabled={isPending || expiresAt === ""}
                onPress={runMint}
              >
                {isPending ? t("forms.links.pending") : t("forms.links.confirmMint")}
              </Button>
              <Button
                variant="ghost"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  setDialog(null);
                }}
              >
                {t("forms.links.cancel")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {revoking !== null && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.links.revokeTitle")}
          description={t("forms.links.revokeBody")}
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setRevoking(null);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                runRevoke(revoking);
              }}
            >
              {isPending ? t("forms.links.pending") : t("forms.links.confirmRevoke")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                setRevoking(null);
              }}
            >
              {t("forms.links.cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/**
 * The one moment the URLs exist.
 *
 * Rendered as a list rather than through the kit table for the same reason the version
 * links are: a kit table cell is text, and every row here needs a copy button beside a
 * selectable URL.
 */
function MintedPanel({
  formId,
  links,
  onCopy,
  onDismiss,
}: {
  readonly formId: string;
  readonly links: readonly MintedLink[];
  readonly onCopy: (url: string) => void;
  readonly onDismiss: () => void;
}) {
  const download = useCallback(() => {
    // A blob URL rather than a server round trip: the URLs are already here and sending
    // them back up so the server can send them down again would put bearer credentials
    // through one more hop for no gain (SEC-13).
    const blob = new Blob([mintedLinksCsv(links)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = mintedLinksFilename(formId);
    anchor.click();
    URL.revokeObjectURL(href);
  }, [links, formId]);

  return (
    <section
      aria-labelledby="qcms-minted-heading"
      data-testid="qcms-minted-links"
      className="flex flex-col gap-3 rounded-md border border-(--color-border-strong) bg-(--color-background-muted) p-4"
    >
      <h3 id="qcms-minted-heading" className="text-base font-semibold text-(--color-text)">
        {t("forms.links.mintedTitle", { count: links.length })}
      </h3>
      <p className="text-sm text-(--color-text-muted)">{t("forms.links.mintedOnce")}</p>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.linkId} className="flex flex-wrap items-center gap-2">
            <code className="qcms-link-url">{link.url}</code>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => {
                onCopy(link.url);
              }}
            >
              {t("forms.links.copy")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="md" onPress={download}>
          {t("forms.links.exportCsv")}
        </Button>
        <Button variant="ghost" size="md" onPress={onDismiss}>
          {t("forms.links.dismissMinted")}
        </Button>
      </div>
    </section>
  );
}

/** The lifecycle table: state, timestamps, and a revoke control for the live ones. */
function LinksTable({
  links,
  onRevoke,
  isPending,
}: {
  readonly links: readonly SecureLink[];
  readonly onRevoke: (linkId: string) => void;
  readonly isPending: boolean;
}) {
  if (links.length === 0) {
    return (
      <p className="text-sm text-(--color-text-muted)" data-testid="qcms-links-empty">
        {t("forms.links.empty")}
      </p>
    );
  }

  return (
    <table className="qcms-links-table" data-testid="qcms-links-table">
      <caption className="qcms-visually-hidden">{t("forms.links.table")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("forms.links.column.linkId")}</th>
          <th scope="col">{t("forms.links.column.state")}</th>
          <th scope="col">{t("forms.links.column.oneTime")}</th>
          <th scope="col">{t("forms.links.column.expiresAt")}</th>
          <th scope="col">{t("forms.links.column.usedAt")}</th>
          <th scope="col">{t("forms.links.column.createdAt")}</th>
          <th scope="col">
            <span className="qcms-visually-hidden">{t("forms.links.revoke")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.linkId} data-link-id={link.linkId} data-state={link.state}>
            <th scope="row">
              <code className="qcms-link-id">{link.linkId}</code>
            </th>
            <td>
              <LinkStateTag state={link.state} />
            </td>
            <td>{link.oneTime ? t("forms.links.yes") : t("forms.links.no")}</td>
            <td>{link.expiresAt}</td>
            <td>{link.consumedAt ?? t("forms.links.none")}</td>
            <td>{link.createdAt}</td>
            <td>
              {isRevocable(link.state) && (
                <Button
                  variant="danger"
                  size="sm"
                  isDisabled={isPending}
                  onPress={() => {
                    onRevoke(link.linkId);
                  }}
                >
                  {t("forms.links.revoke")}
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
