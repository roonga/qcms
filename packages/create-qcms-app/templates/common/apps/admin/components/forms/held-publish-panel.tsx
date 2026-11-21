"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button } from "@/components/kit";
import { useOperatorDateTimeFormat } from "@/components/operator-time";
import {
  blockSentence,
  expirySentence,
  type HeldDecisionState,
  type HeldPublishView,
} from "@/lib/forms/held-publish";
import { t } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

function viewerOf(view: HeldPublishView): "requester" | "approver" | "observer" {
  if (view.own) return "requester";
  return view.decides ? "approver" : "observer";
}

function Waiting({ view }: { readonly view: HeldPublishView }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="qcms-tag qcms-tag--draft" data-testid="qcms-held-publish-waiting">
        {t("forms.publish.held.waiting")}
      </span>
      <span className="text-sm text-(--color-text-muted)">
        {expirySentence(view.expiresInDays)}
      </span>
    </div>
  );
}

function Decision({
  view,
  summary,
  environment,
  decide,
}: {
  readonly view: HeldPublishView;
  readonly summary: string;
  readonly environment: string;
  readonly decide: (
    requestId: string,
    decision: "approve" | "reject",
  ) => Promise<HeldDecisionState>;
}) {
  const router = useRouter();
  const format = useOperatorDateTimeFormat();
  const time = format(view.requestedAt, "");
  const [state, setState] = useState<HeldDecisionState>({ status: "idle" });
  const [acting, setActing] = useState<"approve" | "reject">();
  const [isPending, startTransition] = useTransition();
  const run = (decision: "approve" | "reject") => {
    setActing(decision);
    startTransition(() => {
      void decide(view.requestId, decision)
        .then((next) => {
          setState(next);
          if (next.status !== "error") router.refresh();
        })
        .catch(() => {
          setState({ status: "error", message: unexpected() });
        });
    });
  };
  const done = state.status === "approved" || state.status === "rejected";
  const refusal = state.status === "error" ? state.message : undefined;
  const block = view.block === undefined ? undefined : blockSentence(view.block);

  return (
    <>
      <p className="text-sm font-semibold">{t("forms.publish.requests.approver")}</p>
      <p className="text-sm" data-testid="qcms-held-publish-summary">
        {summary === ""
          ? t("forms.publish.requests.summaryUnread", { time })
          : t("forms.publish.requests.summary", { subject: summary, time })}
      </p>
      <div className="flex flex-col gap-2" aria-live="polite">
        {state.status === "approved" && (
          <Alert variant="success">
            {state.version === undefined
              ? t("forms.publish.requests.approvedUnread", { environment })
              : t("forms.publish.requests.approved", {
                  version: state.version,
                  requester: state.requester ?? t("forms.publish.requests.someone"),
                  approver: state.approver ?? t("forms.publish.requests.you"),
                  environment,
                })}
          </Alert>
        )}
        {state.status === "rejected" && (
          <Alert variant="info">{t("forms.publish.requests.rejected")}</Alert>
        )}
      </div>
      {(refusal ?? block) !== undefined && (
        <p
          className="text-sm text-(--color-danger-fg)"
          role="alert"
          data-testid="qcms-held-publish-refusal"
        >
          {refusal ?? block}
        </p>
      )}
      {!done && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="md"
            isDisabled={isPending || block !== undefined || refusal !== undefined}
            onPress={() => {
              run("approve");
            }}
          >
            {isPending && acting === "approve"
              ? t("forms.publish.requests.approving")
              : t("forms.publish.requests.approve")}
          </Button>
          <Button
            variant="secondary"
            size="md"
            isDisabled={isPending}
            onPress={() => {
              run("reject");
            }}
          >
            {isPending && acting === "reject"
              ? t("forms.publish.requests.rejecting")
              : t("forms.publish.requests.reject")}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * The held draft publishes to `prod` on a site whose only environment is `prod`. The
 * requester sees each one pending; another holder of Publish forms there approves it here,
 * on the form, and nowhere else.
 */
export function HeldPublishPanel({
  views,
  summaries,
  environment,
  decide,
}: {
  readonly views: readonly HeldPublishView[];
  /** By request: what the approver would publish, the draft the request is bound to. */
  readonly summaries: Readonly<Record<string, string>>;
  readonly environment: string;
  readonly decide: (
    requestId: string,
    decision: "approve" | "reject",
  ) => Promise<HeldDecisionState>;
}) {
  if (views.length === 0) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="qcms-held-publishes">
      {views.map((view) => (
        <section
          key={view.requestId}
          aria-labelledby={`qcms-held-${view.requestId}`}
          className="flex flex-col gap-2 rounded-md border border-(--color-border-strong) bg-(--color-surface) p-4"
          data-testid="qcms-held-publish"
          data-request-id={view.requestId}
          data-viewer={viewerOf(view)}
        >
          <h2 id={`qcms-held-${view.requestId}`} className="text-base font-semibold">
            {t("forms.publish.requests.label", { environment })}
          </h2>
          <Waiting view={view} />
          {view.decides ? (
            <Decision
              view={view}
              summary={summaries[view.requestId] ?? ""}
              environment={environment}
              decide={decide}
            />
          ) : (
            <>
              <p className="text-sm">
                {view.own
                  ? t("forms.publish.held")
                  : t("forms.publish.held.requestNote", { environment })}
              </p>
              {view.block !== undefined && (
                <p className="text-sm" data-testid="qcms-held-publish-refusal">
                  {blockSentence(view.block)}
                </p>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
