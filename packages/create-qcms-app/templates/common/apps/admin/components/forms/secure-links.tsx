"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { useEnvironmentUnknown } from "@/components/environment-scope";
import { Alert, Button, Checkbox, DatePicker, Dialog, NumberField } from "@/components/kit";
import { LinkStateTag } from "@/components/forms/link-state-tag";
import type { MintLinksState, RevokeLinkState } from "@/lib/forms/builder-state";
import { IDLE_MINT, IDLE_REVOKE } from "@/lib/forms/builder-state";
import { isRevocable, mintedLinksCsv, mintedLinksFilename } from "@/lib/forms/links";
import type { MintedLink, SecureLink } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";
import { focusPostAction } from "@/lib/ops/post-action-focus";
import { EntityId } from "@/components/entity-id";
import { OperatorDateTime } from "@/components/operator-time";
import { t, tPlural } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";
import { unexpected } from "@/lib/ops/unexpected";

/* Delay object-URL revocation so the browser has time to start the download. */
const REVOKE_DELAY_MS = 60_000;

/* Minted URLs cannot be recovered: the API stores link state without tokens. Keep the one-time copy/export
   panel separate from history. */
export function SecureLinks({
  formId,
  environment,
  links,
  canMint,
  maxBatch,
  mint,
  revoke,
}: {
  readonly formId: string;
  readonly environment: string;
  readonly links: ReadState<readonly SecureLink[]>;
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
  const environmentUnknown = useEnvironmentUnknown();

  const [expiresAt, setExpiresAt] = useState<string>("");
  const [oneTime, setOneTime] = useState(false);
  const [count, setCount] = useState(1);

  const mintTrigger = useRef<HTMLDivElement>(null);

  const runMint = useCallback(() => {
    startTransition(() => {
      void mint({ expiresAt, oneTime, count })
        .then((state) => {
          setMinted(state);
          if (state.status === "minted") setDialog(null);
        })
        .catch(() => {
          setMinted({ status: "error", message: unexpected() });
        });
    });
  }, [mint, expiresAt, oneTime, count]);

  const runRevoke = useCallback(
    (linkId: string) => {
      startTransition(() => {
        void revoke(linkId)
          .then((state) => {
            setRevoked(state);
            if (state.status === "revoked") setRevoking(null);
          })
          .catch(() => {
            setRevoked({ status: "error", message: unexpected() });
          });
      });
    },
    [revoke],
  );

  const copy = useCallback((url: string) => {
    // clipboard may be absent in insecure contexts; protect property access because the synchronous throw
    // precedes any promise catch.
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
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
      </div>

      {canMint ? (
        <HeadingMarker control="links.mint">
          <div ref={mintTrigger}>
            <Button
              variant="primary"
              size="md"
              isDisabled={isPending || environmentUnknown}
              onPress={() => {
                setMinted(IDLE_MINT);
                setDialog("mint");
              }}
            >
              {t("forms.links.mint")}
            </Button>
          </div>
        </HeadingMarker>
      ) : (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-links-needs-publish">
          {t("forms.links.needsPublish")}
        </p>
      )}

      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-links-status">
        {/* Announce only the mint summary, never signed URLs or bearer tokens. */}
        {minted.status === "minted" && minted.links !== undefined && (
          <p className="qcms-visually-hidden">
            {tPlural(
              "forms.links.mintedAnnounce.one",
              "forms.links.mintedAnnounce.other",
              minted.links.length,
            )}
          </p>
        )}
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
            // Restore focus before dismissing the minted panel; otherwise its focused Done button unmounts and strands
            // focus on body.
            focusPostAction(mintTrigger.current?.querySelector("button") ?? null);
          }}
        />
      )}

      <LinksTable
        links={links}
        environment={environment}
        onRevoke={(linkId) => {
          setRevoked(IDLE_REVOKE);
          setRevoking(linkId);
        }}
        isPending={isPending || environmentUnknown}
      />

      {dialog === "mint" && (
        <Dialog
          isOpen
          title={t("forms.links.mintTitle", { environment })}
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDialog(null);
          }}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-(--color-text-muted)" data-testid="qcms-mint-environment">
              {t("forms.links.mintEnvironment", { environment })}
            </p>
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
                {isPending
                  ? t("forms.links.pending")
                  : t("forms.links.confirmMint", { environment })}
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
          <div className="flex flex-col gap-4">
            {revoked.status === "error" && (
              <Alert variant="error">
                {t("forms.links.revokeFailed", { message: revoked.message ?? "" })}
              </Alert>
            )}
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
          </div>
        </Dialog>
      )}
    </section>
  );
}

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
  const heading = useRef<HTMLHeadingElement>(null);

  // Focus after the modal closes too so React Aria's restoration cannot take focus back from the minted
  // panel.
  useEffect(() => focusPostAction(heading.current), []);

  const download = useCallback(() => {
    // Build the CSV locally from minted URLs; sending bearer credentials back through the server adds exposure
    // without new data.
    const blob = new Blob([mintedLinksCsv(links)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = mintedLinksFilename(formId);
    anchor.click();
    // Revoke the object URL on a later task so the download can begin after click.
    setTimeout(() => {
      URL.revokeObjectURL(href);
    }, REVOKE_DELAY_MS);
  }, [links, formId]);

  return (
    <section
      aria-labelledby="qcms-minted-heading"
      data-testid="qcms-minted-links"
      className="flex flex-col gap-3 rounded-md border border-(--color-border-strong) bg-(--color-background-muted) p-4"
    >
      <h3
        id="qcms-minted-heading"
        ref={heading}
        tabIndex={-1}
        className="text-base font-semibold text-(--color-text)"
      >
        {tPlural("forms.links.mintedTitle.one", "forms.links.mintedTitle.other", links.length)}
      </h3>
      <p className="text-sm text-(--color-text-muted)">{t("forms.links.mintedOnce")}</p>
      {links[0] !== undefined && links[0].environment !== "" && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-minted-environment">
          {t("forms.links.mintedEnvironment", { environment: links[0].environment })}
        </p>
      )}
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

function LinksTable({
  links,
  environment,
  onRevoke,
  isPending,
}: {
  readonly links: ReadState<readonly SecureLink[]>;
  readonly environment: string;
  readonly onRevoke: (linkId: string) => void;
  readonly isPending: boolean;
}) {
  if (!links.ok) return null;
  const rows = links.data;

  if (rows.length === 0) {
    return (
      <EmptyState
        heading={t("forms.links.emptyTitle")}
        body={t("forms.links.empty")}
        testId="qcms-links-empty"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-(--color-text-muted)" data-testid="qcms-links-scope">
        {t("forms.links.environmentScope", { environment })}
      </p>
      <div className="qcms-table">
        <table data-testid="qcms-links-table">
          <caption className="qcms-visually-hidden">{t("forms.links.table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("forms.links.column.linkId")}</th>
              <th scope="col">{t("forms.links.column.state")}</th>
              <th scope="col">{t("forms.links.column.oneTime")}</th>
              <th scope="col" className="qcms-cell--num">
                {t("forms.links.column.expiresAt")}
              </th>
              <th scope="col" className="qcms-cell--num">
                {t("forms.links.column.usedAt")}
              </th>
              <th scope="col" className="qcms-cell--num qcms-cell--drop">
                {t("forms.links.column.createdAt")}
              </th>
              <th scope="col">
                <span className="qcms-visually-hidden">{t("forms.links.revoke")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((link) => (
              <tr
                key={link.linkId}
                data-link-id={link.linkId}
                data-state={link.state}
                data-environment={link.environment}
              >
                <th scope="row">
                  <EntityId kind="link" value={link.linkId} />
                </th>
                <td>
                  <LinkStateTag state={link.state} />
                </td>
                <td>{link.oneTime ? t("forms.links.yes") : t("forms.links.no")}</td>
                <td className="qcms-cell--num">
                  <OperatorDateTime iso={link.expiresAt} fallback={t("forms.links.none")} />
                </td>
                <td className="qcms-cell--num">
                  <OperatorDateTime iso={link.consumedAt} fallback={t("forms.links.none")} />
                </td>
                <td className="qcms-cell--num qcms-cell--drop">
                  <OperatorDateTime iso={link.createdAt} fallback={t("forms.links.none")} />
                </td>
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
      </div>
    </div>
  );
}
