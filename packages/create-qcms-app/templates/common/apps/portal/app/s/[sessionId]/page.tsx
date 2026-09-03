import { MessageScreen } from "@/components/message-screen";
import { ProgressiveStep } from "@/components/progressive-step";
import { ApiError, getStep } from "@/lib/server/api";
import { t } from "@/lib/i18n/en";
import { readStepContext } from "@/lib/server/route-helpers";
import { readSessionToken } from "@/lib/server/session-cookie";

/**
 * The flow page (`/s/:sessionId`). SSR-first (ADR-26): the BFF reads the session
 * bearer from the httpOnly cookie and fetches the current step + flow projection
 * server-side, so the first paint is real step content (no spinner, present
 * before hydration). Progressive enhancement (task 044): the SSR paints a
 * natively-submittable `<form>` that works with JavaScript disabled, and
 * `ProgressiveStep` swaps in the controlled `StepFlow` after hydration for
 * per-answer posting and branch re-rendering. Resume: a valid cookie resumes at
 * the current step; a missing/invalid one shows the friendly recovery page. The
 * portal never recompiles and never evaluates rules (R2).
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
    const context = await readStepContext();
    return <ProgressiveStep sessionId={sessionId} initial={step} context={context} />;
  } catch (error) {
    return <ReadFailure error={error} />;
  }
}

/**
 * The screen for a step read that did not return a step: one per outcome the
 * respondent can act on differently, and the generic failure for the rest.
 *
 * Its own component rather than a chain inside `FlowPage` so that adding an
 * outcome is adding a case, not adding to one function's branching (which is
 * what `sonarjs/cognitive-complexity` is measuring).
 */
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
      // ADR-16's semantics gate (issue #723 gave the serve/answer routes this
      // typed 409; issue #743 gives it a screen). The snapshot this session is
      // pinned to records evaluation semantics this release does not implement,
      // so nothing the respondent does can move the flow forward: not a retry,
      // not a reload, not starting again. That makes it its own terminal screen
      // rather than the generic "we could not reach the server" - which invites
      // exactly the retry that cannot work - and rather than the recovery page,
      // which invites a restart that lands on the same refusal.
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
