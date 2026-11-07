"use client";

import { useCallback, useState, useTransition } from "react";

import { HelpTip } from "@/components/help-tip";
import { EmptyState } from "@/components/empty-state";
import { EntityId } from "@/components/entity-id";
import { useEnvironmentUnknown } from "@/components/environment-scope";
import { Alert, Button, Checkbox, Dialog, TextField } from "@/components/kit";
import type { ReadState } from "@/lib/read-state";
import type { EndpointProposal, RevealedWebhook, WebhookSummary } from "@/lib/ops/types";
import { unexpected } from "@/lib/ops/unexpected";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";

export interface WebhookActionState {
  readonly status: "idle" | "done" | "pending" | "error";
  readonly revealed?: RevealedWebhook;
  readonly pending?: EndpointProposal;
  readonly message?: string;
}

const IDLE: WebhookActionState = { status: "idle" };

/* The secret exists in one response only: never log it, put it in a URL, send it back, or retain it after
   dismissal. */
export function WebhookConfig({
  webhooks,
  create,
  rotate,
  deactivate,
  reactivate,
  retarget,
}: {
  readonly webhooks: ReadState<readonly WebhookSummary[]>;
  readonly create: (request: {
    readonly url: string;
    readonly active: boolean;
  }) => Promise<WebhookActionState>;
  readonly rotate: (webhookId: string) => Promise<WebhookActionState>;
  readonly deactivate: (webhookId: string) => Promise<WebhookActionState>;
  readonly reactivate: (webhookId: string) => Promise<WebhookActionState>;
  readonly retarget: (webhookId: string, url: string) => Promise<WebhookActionState>;
}) {
  /* Keep the narrowed endpoints in a const so TypeScript preserves the read-state narrowing inside dialog
     callbacks. */
  const rows = webhooks.ok ? webhooks.data : undefined;

  const [dialog, setDialog] = useState<
    | { readonly kind: "create" }
    | { readonly kind: "rotate" | "deactivate" | "retarget"; readonly webhookId: string }
    | null
  >(null);
  const [state, setState] = useState<WebhookActionState>(IDLE);
  const [revealed, setRevealed] = useState<RevealedWebhook | null>(null);
  const [copyNote, setCopyNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const environmentUnknown = useEnvironmentUnknown();

  const run = useCallback((call: () => Promise<WebhookActionState>) => {
    startTransition(() => {
      void call()
        .then((next) => {
          setState(next);
          if (next.status !== "done" && next.status !== "pending") return;
          setDialog(null);
          if (next.revealed !== undefined) setRevealed(next.revealed);
        })
        .catch(() => {
          setState({ status: "error", message: unexpected() });
        });
    });
  }, []);

  const copy = useCallback((secret: string) => {
    // clipboard may be absent despite lib.dom types; guard access before creating the promise so synchronous
    // failures remain visible.
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(secret))
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
        <div className="qcms-help-head">
          <h2 id="qcms-webhooks-heading" className="text-lg font-semibold text-(--color-text)">
            {t("ops.webhooks.heading")}
          </h2>
          <HelpTip>{t("ops.webhooks.intro")}</HelpTip>
        </div>
      </div>

      {/* A failed list read must keep creation available; only a successful empty read delegates creation to the
   empty panel. */}
      {(rows === undefined || rows.length > 0) && (
        <HeadingMarker
          control={[
            "webhooks.create",
            "webhooks.rotate",
            "webhooks.retarget",
            "webhooks.activation",
          ]}
        >
          <Button
            variant="primary"
            size="md"
            isDisabled={isPending || environmentUnknown}
            onPress={() => {
              setState(IDLE);
              setDialog({ kind: "create" });
            }}
          >
            {t("ops.webhooks.add")}
          </Button>
        </HeadingMarker>
      )}

      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-webhook-status">
        {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
        {state.status === "pending" && (
          <div data-testid="qcms-webhook-pending">
            <Alert variant="info">
              {t("ops.proposals.stored", { environment: state.pending?.environment ?? "" })}
            </Alert>
          </div>
        )}
        {copyNote !== "" && <p className="text-sm text-(--color-text-muted)">{copyNote}</p>}
      </div>

      {/* Mount the secret's empty live region first so its later one-time message is reliably announced. */}
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

      {rows !== undefined &&
        (rows.length === 0 ? (
          <EmptyState
            heading={t("ops.webhooks.emptyTitle")}
            body={t("ops.webhooks.empty")}
            testId="qcms-webhooks-empty"
            action={
              <Button
                variant="primary"
                size="md"
                isDisabled={isPending || environmentUnknown}
                onPress={() => {
                  setState(IDLE);
                  setDialog({ kind: "create" });
                }}
              >
                {t("ops.webhooks.add")}
              </Button>
            }
          />
        ) : (
          <div className="qcms-table">
            <table data-testid="qcms-webhooks-table">
              <caption className="qcms-visually-hidden">{t("ops.webhooks.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("ops.webhooks.column.webhookId")}</th>
                  <th scope="col">{t("ops.webhooks.column.url")}</th>
                  <th scope="col">{t("ops.webhooks.column.state")}</th>
                  <th scope="col" className="qcms-cell--drop">
                    {t("ops.webhooks.column.secret")}
                  </th>
                  <th scope="col" className="qcms-cell--num qcms-cell--drop">
                    {t("ops.webhooks.column.createdAt")}
                  </th>
                  <th scope="col">{t("ops.webhooks.column.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((hook) => (
                  <tr key={hook.webhookId} data-webhook-id={hook.webhookId}>
                    <th scope="row">
                      <EntityId kind="webhook" value={hook.webhookId} />
                    </th>
                    <td>
                      <span className="qcms-link-url">{hook.url}</span>
                    </td>
                    <td>
                      <span
                        className={`qcms-tag qcms-tag--hook-${hook.active ? "active" : "inactive"}`}
                        data-active={hook.active ? "true" : "false"}
                      >
                        {t(
                          hook.active ? "ops.webhooks.state.active" : "ops.webhooks.state.inactive",
                        )}
                      </span>
                    </td>
                    <td className="qcms-cell--drop text-(--color-text-muted)">
                      {t("ops.webhooks.secretStored")}
                    </td>
                    <td className="qcms-cell--num qcms-cell--drop">
                      <OperatorDateTime iso={hook.createdAt} fallback={t("ops.common.none")} />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          isDisabled={isPending || environmentUnknown}
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
                          isDisabled={isPending || environmentUnknown}
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
                            isDisabled={isPending || environmentUnknown}
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
                            isDisabled={isPending || environmentUnknown}
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
          </div>
        ))}

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
          initialUrl={rows?.find((hook) => hook.webhookId === dialog.webhookId)?.url ?? ""}
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
          error={state.status === "error" ? state.message : undefined}
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
          error={state.status === "error" ? state.message : undefined}
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

/* Use an assertive announcement because this is the operator's only chance to capture the secret. */
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

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly isPending: boolean;
  readonly error?: string | undefined;
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
      <div className="flex flex-col gap-4">
        {error !== undefined && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" size="md" isDisabled={isPending} onPress={onConfirm}>
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
