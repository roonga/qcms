"use client";

import { useCallback, useState, useTransition } from "react";

import { Alert, Button, Checkbox, Dialog, TextField } from "@/components/kit";
import type { RevealedWebhook, WebhookSummary } from "@/lib/ops/types";
import { unexpected } from "@/lib/ops/unexpected";
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/en";

/** What a webhook mutation hands back to this screen. */
export interface WebhookActionState {
  readonly status: "idle" | "done" | "error";
  readonly revealed?: RevealedWebhook;
  readonly message?: string;
}

const IDLE: WebhookActionState = { status: "idle" };

/**
 * Per-form webhook configuration (task 035; wireframe "webhook config").
 *
 * ## The secret is a state of this screen, not a column of the table
 *
 * Exactly the shape `secure-links.tsx` uses for a minted link URL, and for exactly
 * the same reason: the value exists in one response and can never be produced again.
 * The API stores AES-256-GCM ciphertext and has no route that decrypts it back out
 * (SEC-6), so a secret not copied out of this panel is gone and the only recovery is
 * a rotation. The panel says that in those words rather than implying it, and the
 * table below shows "stored, not retrievable" where a secret column would otherwise
 * invite someone to look for it.
 *
 * The value is never logged, never put in a URL, never sent back up, and is dropped
 * from component state the moment the panel is dismissed (SEC-8, SEC-13).
 *
 * ## Rotate, deactivate and retarget each state their own consequence
 *
 * All three are confirmations rather than instant actions, and none of them says "are
 * you sure": rotation breaks consumers still verifying with the old secret,
 * deactivation stops fan-out while leaving queued deliveries alone, and retargeting
 * moves queued deliveries (including redelivered ones) to the new URL. Those are the
 * three things an operator is about to find out; the dialogs say them first.
 */
export function WebhookConfig({
  webhooks,
  create,
  rotate,
  deactivate,
  reactivate,
  retarget,
}: {
  readonly webhooks: readonly WebhookSummary[];
  readonly create: (request: {
    readonly url: string;
    readonly active: boolean;
  }) => Promise<WebhookActionState>;
  readonly rotate: (webhookId: string) => Promise<WebhookActionState>;
  readonly deactivate: (webhookId: string) => Promise<WebhookActionState>;
  readonly reactivate: (webhookId: string) => Promise<WebhookActionState>;
  readonly retarget: (webhookId: string, url: string) => Promise<WebhookActionState>;
}) {
  const [dialog, setDialog] = useState<
    | { readonly kind: "create" }
    | { readonly kind: "rotate" | "deactivate" | "retarget"; readonly webhookId: string }
    | null
  >(null);
  const [state, setState] = useState<WebhookActionState>(IDLE);
  const [revealed, setRevealed] = useState<RevealedWebhook | null>(null);
  const [copyNote, setCopyNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const run = useCallback((call: () => Promise<WebhookActionState>) => {
    startTransition(() => {
      void call()
        .then((next) => {
          setState(next);
          if (next.status !== "done") return;
          setDialog(null);
          if (next.revealed !== undefined) setRevealed(next.revealed);
        })
        // `.catch` is not defensive decoration. `adminApiFetch` documents that it does not
        // throw for a non-2xx, which is true and is the trap: a transport failure still
        // rejects with a TypeError, and `readResult`'s `response.json()` rejects on a
        // truncated body. Without this the promise rejects unhandled, no state is set,
        // and the dialog sits there looking like a slow network forever.
        .catch(() => {
          setState({ status: "error", message: unexpected() });
        });
    });
  }, []);

  const copy = useCallback((secret: string) => {
    void navigator.clipboard
      .writeText(secret)
      .then(() => {
        setCopyNote(t("ops.common.copied"));
      })
      .catch(() => {
        setCopyNote(t("ops.common.copyFailed"));
      });
  }, []);

  return (
    <section
      aria-labelledby="qcms-webhooks-heading"
      className="flex flex-col gap-4"
      data-testid="qcms-webhook-config"
    >
      <div className="flex flex-col gap-1">
        <h2 id="qcms-webhooks-heading" className="text-lg font-semibold text-(--color-text)">
          {t("ops.webhooks.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("ops.webhooks.intro")}</p>
      </div>

      <div>
        <Button
          variant="primary"
          size="md"
          isDisabled={isPending}
          onPress={() => {
            setState(IDLE);
            setDialog({ kind: "create" });
          }}
        >
          {t("ops.webhooks.add")}
        </Button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
        {copyNote !== "" && <p className="text-sm text-(--color-text-muted)">{copyNote}</p>}
      </div>

      {/* The secret's live region is mounted from first render and filled later, never
          mounted together with what it should announce (issue #307). A region that
          appears already populated is announced unreliably across screen readers -
          several only observe mutations of a region they were already watching - and
          this is the one announcement in the app that cannot be repeated, because the
          value it names is shown exactly once (SEC-6). The `polite` region above and
          the ones in `dead-letters.tsx` and `response-detail.tsx` have this shape; this
          one was the exception. */}
      <div aria-live="assertive" data-testid="qcms-webhook-secret-region">
        {revealed !== null && (
          <SecretPanel
            revealed={revealed}
            onCopy={copy}
            onDismiss={() => {
              setRevealed(null);
              setCopyNote("");
            }}
          />
        )}
      </div>

      {webhooks.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-webhooks-empty">
          {t("ops.webhooks.empty")}
        </p>
      ) : (
        <table className="qcms-ops-table" data-testid="qcms-webhooks-table">
          <caption className="qcms-visually-hidden">{t("ops.webhooks.table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("ops.webhooks.column.webhookId")}</th>
              <th scope="col">{t("ops.webhooks.column.url")}</th>
              <th scope="col">{t("ops.webhooks.column.state")}</th>
              <th scope="col">{t("ops.webhooks.column.secret")}</th>
              <th scope="col">{t("ops.webhooks.column.createdAt")}</th>
              <th scope="col">{t("ops.webhooks.column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map((hook) => (
              <tr key={hook.webhookId} data-webhook-id={hook.webhookId}>
                <th scope="row">
                  <code className="qcms-link-id">{hook.webhookId}</code>
                </th>
                <td>
                  <span className="qcms-link-url">{hook.url}</span>
                </td>
                <td>
                  <span
                    className={`qcms-tag qcms-tag--hook-${hook.active ? "active" : "inactive"}`}
                    data-active={hook.active ? "true" : "false"}
                  >
                    {t(hook.active ? "ops.webhooks.state.active" : "ops.webhooks.state.inactive")}
                  </span>
                </td>
                <td className="text-(--color-text-muted)">{t("ops.webhooks.secretStored")}</td>
                <td>{formatDateTime(hook.createdAt, t("ops.common.none"))}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={isPending}
                      onPress={() => {
                        setState(IDLE);
                        setDialog({ kind: "retarget", webhookId: hook.webhookId });
                      }}
                    >
                      {t("ops.webhooks.retarget")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={isPending}
                      onPress={() => {
                        setState(IDLE);
                        setDialog({ kind: "rotate", webhookId: hook.webhookId });
                      }}
                    >
                      {t("ops.webhooks.rotate")}
                    </Button>
                    {hook.active ? (
                      <Button
                        variant="danger"
                        size="sm"
                        isDisabled={isPending}
                        onPress={() => {
                          setState(IDLE);
                          setDialog({ kind: "deactivate", webhookId: hook.webhookId });
                        }}
                      >
                        {t("ops.webhooks.deactivate")}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={isPending}
                        onPress={() => {
                          setState(IDLE);
                          run(() => reactivate(hook.webhookId));
                        }}
                      >
                        {t("ops.webhooks.reactivate")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog?.kind === "create" && (
        <UrlDialog
          title={t("ops.webhooks.addTitle")}
          confirmLabel={t("ops.webhooks.create")}
          initialUrl=""
          withActiveToggle
          isPending={isPending}
          error={state.status === "error" ? state.message : undefined}
          onConfirm={(url, active) => {
            run(() => create({ url, active }));
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "retarget" && (
        <UrlDialog
          title={t("ops.webhooks.retargetTitle")}
          description={t("ops.webhooks.retargetBody")}
          confirmLabel={t("ops.webhooks.confirmRetarget")}
          initialUrl={webhooks.find((hook) => hook.webhookId === dialog.webhookId)?.url ?? ""}
          isPending={isPending}
          error={state.status === "error" ? state.message : undefined}
          onConfirm={(url) => {
            run(() => retarget(dialog.webhookId, url));
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "rotate" && (
        <ConfirmDialog
          title={t("ops.webhooks.rotateTitle")}
          body={t("ops.webhooks.rotateBody")}
          confirmLabel={t("ops.webhooks.confirmRotate")}
          isPending={isPending}
          onConfirm={() => {
            run(() => rotate(dialog.webhookId));
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "deactivate" && (
        <ConfirmDialog
          title={t("ops.webhooks.deactivateTitle")}
          body={t("ops.webhooks.deactivateBody")}
          confirmLabel={t("ops.webhooks.confirmDeactivate")}
          isPending={isPending}
          onConfirm={() => {
            run(() => deactivate(dialog.webhookId));
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

/**
 * The one moment the secret exists on screen.
 *
 * The panel is the **content** of an assertive live region rather than the region
 * itself (issue #307): its caller keeps an empty `aria-live="assertive"` container
 * mounted and this panel appears inside it. Assertive because the wireframe's a11y
 * note asks for it and the reason is the content, not the style: this panel is the
 * only chance to capture the value, and a polite announcement can be queued behind
 * whatever else the page is saying.
 */
function SecretPanel({
  revealed,
  onCopy,
  onDismiss,
}: {
  readonly revealed: RevealedWebhook;
  readonly onCopy: (secret: string) => void;
  readonly onDismiss: () => void;
}) {
  return (
    <section
      aria-labelledby="qcms-secret-heading"
      data-testid="qcms-webhook-secret"
      className="flex flex-col gap-3 rounded-md border border-(--color-border-strong) bg-(--color-background-muted) p-4"
    >
      <h3 id="qcms-secret-heading" className="text-base font-semibold text-(--color-text)">
        {t("ops.webhooks.secretTitle")}
      </h3>
      <p className="text-sm text-(--color-text-muted)">{t("ops.webhooks.secretOnce")}</p>
      {revealed.secret === "" ? (
        // The API always returns a secret from create and rotate, so this is a broken
        // contract rather than a variant - but an empty `<code>` under "Copy this
        // secret now" would read as "your secret is nothing", which is worse than
        // saying what happened and how to recover.
        <p className="text-sm text-(--color-text)" data-testid="qcms-webhook-secret-missing">
          {t("ops.webhooks.secretMissing")}
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2">
          <span className="qcms-visually-hidden">
            {t("ops.webhooks.secretLabel", { webhookId: revealed.webhookId })}
          </span>
          <code className="qcms-link-url" data-testid="qcms-webhook-secret-value">
            {revealed.secret}
          </code>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {revealed.secret !== "" && (
          <Button
            variant="secondary"
            size="md"
            onPress={() => {
              onCopy(revealed.secret);
            }}
          >
            {t("ops.common.copy")}
          </Button>
        )}
        <Button variant="ghost" size="md" onPress={onDismiss}>
          {t("ops.webhooks.secretDismiss")}
        </Button>
      </div>
    </section>
  );
}

/** Create or retarget: one URL field, optionally an active toggle. */
function UrlDialog({
  title,
  description,
  confirmLabel,
  initialUrl,
  withActiveToggle = false,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly initialUrl: string;
  readonly withActiveToggle?: boolean;
  readonly isPending: boolean;
  readonly error?: string | undefined;
  readonly onConfirm: (url: string, active: boolean) => void;
  readonly onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [active, setActive] = useState(true);

  return (
    <Dialog
      isOpen
      title={title}
      {...(description === undefined ? {} : { description })}
      isDismissable={!isPending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <div className="flex flex-col gap-4" data-testid="qcms-webhook-url-dialog">
        <TextField
          label={t("ops.webhooks.url")}
          description={t("ops.webhooks.urlHint")}
          type="url"
          value={url}
          onChange={setUrl}
        />
        {withActiveToggle && (
          <Checkbox label={t("ops.webhooks.activeNow")} isSelected={active} onChange={setActive} />
        )}
        {error !== undefined && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="md"
            isDisabled={isPending || url.trim() === ""}
            onPress={() => {
              onConfirm(url.trim(), active);
            }}
          >
            {isPending ? t("ops.common.working") : confirmLabel}
          </Button>
          <Button variant="ghost" size="md" isDisabled={isPending} onPress={onClose}>
            {t("ops.common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** A consequence, stated, then a button that accepts it. */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  isPending,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly isPending: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      isOpen
      role="alertdialog"
      title={title}
      description={body}
      isDismissable={!isPending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="md" isDisabled={isPending} onPress={onConfirm}>
          {isPending ? t("ops.common.working") : confirmLabel}
        </Button>
        <Button variant="ghost" size="md" isDisabled={isPending} onPress={onClose}>
          {t("ops.common.cancel")}
        </Button>
      </div>
    </Dialog>
  );
}
