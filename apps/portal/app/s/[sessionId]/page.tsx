import { MessageScreen } from "@/components/message-screen";
import { StepFlow } from "@/components/step-flow";
import { ApiError, getStep } from "@/lib/server/api";
import { t } from "@/lib/i18n/en";
import { readSessionToken } from "@/lib/server/session-cookie";

/**
 * The flow page (`/s/:sessionId`). SSR-first (ADR-26): the BFF reads the session
 * bearer from the httpOnly cookie and fetches the current step + flow projection
 * server-side, so the first paint is real step content (no spinner, present
 * before hydration). The client `StepFlow` then hydrates for per-answer posting
 * and branch re-rendering. Resume: a valid cookie resumes at the current step; a
 * missing/invalid one shows the friendly recovery page. The portal never
 * recompiles and never evaluates rules (R2).
 */
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
    return <StepFlow sessionId={sessionId} initial={step} />;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "SESSION_EXPIRED") {
        return <MessageScreen tone="error" title={t("expired.title")} body={t("expired.body")} />;
      }
      if (error.code === "SESSION_SUBMITTED") {
        return (
          <MessageScreen tone="success" title={t("completion.title")} body={t("completion.body")} />
        );
      }
      if (error.status === 401 || error.code === "SESSION_NOT_FOUND") {
        return <Recovery />;
      }
    }
    return (
      <MessageScreen tone="error" title={t("session.lost.title")} body={t("session.lost.body")} />
    );
  }
}

function Recovery() {
  return <MessageScreen tone="neutral" title={t("recovery.title")} body={t("recovery.body")} />;
}
