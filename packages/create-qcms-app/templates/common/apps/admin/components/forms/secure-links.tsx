"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Checkbox, DatePicker, Dialog, NumberField } from "@/components/kit";
import { LinkStateTag } from "@/components/forms/link-state-tag";
import type { MintLinksState, RevokeLinkState } from "@/lib/forms/builder-state";
import { IDLE_MINT, IDLE_REVOKE } from "@/lib/forms/builder-state";
import { isRevocable, mintedLinksCsv, mintedLinksFilename } from "@/lib/forms/links";
import type { MintedLink, SecureLink } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";
import { focusPostAction } from "@/lib/ops/post-action-focus";
import { OperatorDateTime } from "@/components/operator-time";
import { t, tPlural } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

/**
 * How long a blob URL is kept alive after the download anchor is clicked.
 *
 * Long enough that the browser has certainly started the transfer, short enough that the
 * bytes are not pinned for the life of the screen. A minute is what the common
 * implementations of this pattern settle on and there is nothing to tune here: the only
 * failure mode below it is the race this constant exists to avoid.
 */
const REVOKE_DELAY_MS = 60_000;

/**
 * The secure-link screen: mint, list, copy, export, revoke (task 034; screen contract "secure
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
 * ## Why the mint announcement is polite and not assertive
 *
 * A minted URL is unrecoverable once the panel is dismissed, which is the argument #307
 * accepted for the webhook secret when it made that region `assertive`. It does not carry
 * over, because what this region announces is a **summary and not the URLs** (#377). The
 * value itself stays on screen, in a panel with a heading, copy buttons and a CSV export,
 * until the operator presses Done - so a missed announcement costs a moment's exploration,
 * not the links. Against that, `assertive` interrupts whatever the screen reader is saying
 * at the time, and the thing it would cut off here is the mint dialog closing and focus
 * returning to the Mint button: the operator would hear that links exist and lose where
 * they are standing. Polite queues behind that and is spoken immediately after it.
 *
 * ## Why the minted panel takes focus, and what happens when it is dismissed (issue 379)
 *
 * The announcement above tells a screen-reader operator that links exist. It does not put
 * them anywhere near the copy button, and the panel's token is shown exactly once - so an
 * operator who tabs past the panel, or presses Done to get back to where they were, has
 * lost the links for good. Of the three shapes issue 379 put up, this implements the first
 * one in its automatic form: **focus moves to the panel on a successful mint.** A skip-link
 * affordance was the alternative, and it was not taken because it is one more thing to
 * find at the exact moment the operator has something unrecoverable on screen; the panel is
 * this screen's whole answer to what they just pressed, so landing on it is the honest
 * destination rather than an interruption.
 *
 * **To the panel's own heading**, which is #308's precedent rather than a fresh call: a
 * heading carries a role and a name, so it announces where focus went without an
 * `aria-label` on a generic wrapper, and reading on from it reaches the "cannot be shown
 * again" sentence, then each URL and its copy button. Not the live region, which would say
 * the same sentence twice, and not the first copy button, which would announce a control
 * without the sentence that explains why pressing it matters.
 *
 * **Dismiss puts focus back on Mint links.** Moving focus in without moving it out trades
 * one lost place for another: Done unmounts the element holding focus, so the browser's
 * default is `<body>` at the top of the document. Mint links is where the operator was
 * standing when this began and is the control that would start the next batch.
 *
 * The screen contract names a `switch` for the one-time control. The vendored a2ra set has no
 * Switch, and hand-writing one is exactly what ADR-22 forbids, so this uses the vendored
 * `Checkbox` - the same substitution `form-settings-panel.tsx` makes for its booleans. A
 * real Switch would be a COMPONENT_GUIDELINES vendoring in its own right.
 *
 * ## A failed list read is not a form with no links (issues 572, 544)
 *
 * `links` is a `ReadState` (`lib/read-state.ts`), not an array. It used to be handed
 * `ok ? data : []`, so a list that could not be read printed §3's "No links yet" panel
 * with "No links have been minted for this form." underneath the page's own warning that
 * the link list could not be loaded. An author reading that would conclude a link they
 * minted an hour ago had vanished, and the natural response to that conclusion is to mint
 * another one.
 *
 * The claim-versus-capability split §3 asks for lands here as: drop the lifecycle table
 * and its empty panel, because both are statements about links that were never read; keep
 * everything else. The heading and intro stay because the alert above needs a subject.
 * **Minting stays**, because it does not depend on the list that failed - whether this
 * form can mint at all is decided by its published versions, which came from the form
 * read, and minting is the thing an author most often came here to do. So does the mint
 * result panel: those URLs are this session's own answer and not part of the read.
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
  readonly links: ReadState<readonly SecureLink[]>;
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

  // WHERE FOCUS GOES WHEN THE MINTED PANEL IS DISMISSED (issue 379). A ref on the wrapper
  // and not on the control, because the vendored `Button` takes no `ref` and ADR-22 forbids
  // giving it one; `library-picker.tsx` reaches its search field the same way. The div is
  // rendered whenever minting is possible at all, which is the only state that can produce
  // a panel to dismiss.
  const mintTrigger = useRef<HTMLDivElement>(null);

  const runMint = useCallback(() => {
    startTransition(() => {
      void mint({ expiresAt, oneTime, count })
        .then((state) => {
          setMinted(state);
          if (state.status === "minted") setDialog(null);
        })
        // `.catch` is not defensive decoration. `adminApiFetch` documents that it does not
        // throw for a non-2xx, which is true and is the trap: a transport failure still
        // rejects with a TypeError, and `readResult`'s `response.json()` rejects on a
        // truncated body. Without this the promise rejects unhandled, no state is set,
        // and the dialog sits there looking like a slow network forever.
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
          // The same trap as `runMint`. The dialog stays open here, exactly as it does for
          // a returned failure, and it is the confirmation dialog below that renders the
          // sentence: a modal covers the page's own alert region, so a revoke failure that
          // only wrote there would leave the operator staring at an unchanged dialog.
          .catch(() => {
            setRevoked({ status: "error", message: unexpected() });
          });
      });
    },
    [revoke],
  );

  const copy = useCallback((url: string) => {
    // The same shape and the same reason as `public-form-link.tsx`, which writes it out:
    // `navigator.clipboard` is absent in an insecure context, so calling `.writeText` off it
    // throws synchronously and a bare `.catch` never sees it. Inside a `.then`, that throw
    // becomes a rejection and lands with every other failure. Found by review on the new
    // control and fixed here too rather than left as the same defect one file away.
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
        <p className="text-sm text-(--color-text-muted)">{t("forms.links.intro")}</p>
      </div>

      {canMint ? (
        <div ref={mintTrigger}>
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

      {/* Testid on the region rather than only on its contents, so the `aria-live` can be
          asserted directly (#368). */}
      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-links-status">
        {/* A successful mint used to be the one outcome on this screen that announced
            nothing, because `MintedPanel` is a sibling of this region rather than a child
            of it (#377). What arrives here is a summary and never the URLs: a token read
            aloud cannot be copied, the panel below holds them until it is dismissed, and
            the copy buttons and the CSV export are the only ways to get them out. Hidden
            rather than rendered, because the panel's own heading already says this to
            anyone who can see it. */}
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
            // Before the browser can fall back to `<body>`: Done unmounts the element that
            // holds focus, so leaving this to the default strands a keyboard operator at
            // the top of the document (issue 379, the same failure #308 documents).
            focusPostAction(mintTrigger.current?.querySelector("button") ?? null);
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
          <div className="flex flex-col gap-4">
            {/* The same placement the mint dialog gives its own failure, and for the same
                reason: this dialog is modal, so the page's alert region is behind it and a
                failure written only there is a failure the operator cannot see. */}
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
  const heading = useRef<HTMLHeadingElement>(null);

  // ON MOUNT, which is exactly once per mint: `SecureLinks` clears the result before it
  // opens the dialog, so this component is unmounted between batches and a second mint
  // remounts it. `focusPostAction` focuses now and again on the next frame, which is what
  // makes it the last word rather than a race with React Aria returning focus to Mint links
  // as the dialog closes in the same commit.
  useEffect(() => focusPostAction(heading.current), []);

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
    // Revoked on a later task, never synchronously after `click()`. A download is started
    // asynchronously by the browser, so revoking on the next line races it: several
    // browsers free the blob before the transfer has begun and the operator gets an empty
    // or truncated CSV. It fails intermittently and only in the real product - the e2e
    // asserts the download EVENT, which fires either way - which is the worst shape a bug
    // can take on something advertised as a deliverable. The blob still has to be freed
    // (it pins its bytes in memory for the life of the document), so this is a delay
    // rather than a leak.
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
      {/* Focusable so a successful mint can land the operator on the thing they just made
          (issue 379). `-1` keeps it out of the tab order: it is a destination, not a stop -
          the same shape `ops/tombstone-card.tsx` uses for the same reason. */}
      <h3
        id="qcms-minted-heading"
        ref={heading}
        tabIndex={-1}
        className="text-base font-semibold text-(--color-text)"
      >
        {tPlural("forms.links.mintedTitle.one", "forms.links.mintedTitle.other", links.length)}
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
  readonly links: ReadState<readonly SecureLink[]>;
  readonly onRevoke: (linkId: string) => void;
  readonly isPending: boolean;
}) {
  // Three states, not two (issue 572). A read that failed has neither a table nor an
  // empty state to draw: both would describe links nobody managed to list. The page's
  // alert above says what happened, and §3 asks for nothing else.
  if (!links.ok) return null;
  const rows = links.data;

  if (rows.length === 0) {
    // §3's panel. No CTA: this screen's creating action is the mint fieldset rendered
    // directly above, which takes a count and an expiry rather than being a button that
    // goes somewhere, so there is nothing for a CTA to point at.
    return (
      <EmptyState
        heading={t("forms.links.emptyTitle")}
        body={t("forms.links.empty")}
        testId="qcms-links-empty"
      />
    );
  }

  // One table family (§2). WHICH COLUMN DROPS AT COMPACT WIDTH: Minted. Expiry and Used
  // are the live lifecycle facts an operator revokes on; the minting stamp is provenance
  // and describes rather than identifies. Nothing else drops, the revoke control least of
  // all.
  //
  // NOTE ON THE ONE-TIME REVEAL, which the issue flagged as the likeliest place the
  // card's shape would not fit: it is not in this table and never was. A minted link's
  // URL is shown exactly once, in `MintedPanel` above, which is a list and not a table
  // and is neither an empty state nor collapsible (§3). This table holds link IDS and
  // lifecycle stamps - it never rendered a token - so the family applies to it with no
  // tension at all.
  return (
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
            <tr key={link.linkId} data-link-id={link.linkId} data-state={link.state}>
              <th scope="row">
                <code className="qcms-link-id">{link.linkId}</code>
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
  );
}
