import { MessageScreen } from "@/components/message-screen";
import { ProgressiveStep } from "@/components/progressive-step";
import { ApiError, getStep } from "@/lib/server/api";
import { t } from "@/lib/i18n/en";
import { readStepContext } from "@/lib/server/route-helpers";
import { readSessionToken } from "@/lib/server/session-cookie";
import { currentBasePath } from "@/lib/server/environment";
import { newOperationToken } from "@/lib/server/operation-token";

export default async function FlowPage({
  params,
}: {
  readonly params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const token = await readSessionToken();

  if (token === undefined) {
    return <Recovery />;
  }

  try {
    const step = await getStep(sessionId, token);
    const context = await readStepContext();
    // One roster-operation token per render (ADR-43), minted on the server so SSR and
    // the first client render agree. Its only job is to make a doubled post apply once;
    // it is not a credential and is meaningless outside its session.
    return (
      <ProgressiveStep
        sessionId={sessionId}
        initial={step}
        context={context}
        opToken={newOperationToken()}
        // Every address the step emits has to stay inside the environment the
        // respondent entered (Q21).
        basePath={await currentBasePath()}
      />
    );
  } catch (error) {
    return <ReadFailure error={error} />;
  }
}

function ReadFailure({ error }: { readonly error: unknown }) {
  if (!(error instanceof ApiError)) {
    return (
      <MessageScreen tone="error" title={t("session.lost.title")} body={t("session.lost.body")} />
    );
  }
  switch (error.code) {
    case "SESSION_EXPIRED":
      return <MessageScreen tone="error" title={t("expired.title")} body={t("expired.body")} />;
    case "SESSION_SUBMITTED":
      return (
        <MessageScreen tone="success" title={t("completion.title")} body={t("completion.body")} />
      );
    case "UNSUPPORTED_SEMANTICS_VERSION":
      // ADR-16's semantics gate: the pinned snapshot needs semantics this release does
      // not implement, so no retry or restart can move the flow forward. Hence its own
      // terminal screen rather than the generic failure or the recovery page, both of
      // which invite an action that cannot work.
      return (
        <MessageScreen
          tone="error"
          title={t("formSuperseded.title")}
          body={t("formSuperseded.body")}
        />
      );
    case "SESSION_NOT_FOUND":
      return <Recovery />;
    default:
      // Any other 401 is a credential the API would not accept, which the
      // recovery page is written for; everything else is the generic failure.
      return error.status === 401 ? (
        <Recovery />
      ) : (
        <MessageScreen tone="error" title={t("session.lost.title")} body={t("session.lost.body")} />
      );
  }
}

function Recovery() {
  return <MessageScreen tone="neutral" title={t("recovery.title")} body={t("recovery.body")} />;
}
