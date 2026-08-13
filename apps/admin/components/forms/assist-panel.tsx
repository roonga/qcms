"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, Button, Card, TextField } from "@/components/kit";
import { acceptedDraft, proposalDiff, type DiffEntry } from "@/lib/forms/assist-diff";
import {
  readAssistEvents,
  type AssistErrorCode,
  type AssistEvent,
  type AssistProposal,
  type AssistTurn,
} from "@/lib/forms/assist-stream";
import type { DraftForm } from "@/lib/forms/types";
import { t, tPlural, type MessageKey } from "@/lib/i18n/en";

import { IssueEntry } from "./validation-panel";

/**
 * The agent-authoring chat panel (task 041; wireframe `admin-agent-panel.md`).
 *
 * ## What owns what
 *
 * `FormBuilder` owns the working draft; this component owns the conversation. Accept
 * hands the parsed proposal up through `onAccept` and stops there - the builder is the
 * one that mutates its own draft and runs it through the *same* autosave/validation
 * loop every other edit takes (`agentAssisted: true` on that one save). Nothing here
 * calls `saveDraft` itself, and nothing here can: this module never imports
 * `lib/server/*`.
 *
 * ## The guardrail surface
 *
 * There is no publish, erase, link or webhook affordance anywhere below - not
 * disabled, not hidden, simply never written. The tool allowlist is enforced
 * server-side (041); this is the UI mirroring it by construction rather than by
 * checking a permission.
 *
 * ## Streaming
 *
 * `fetch(endpoint).body` is read by `readAssistEvents` (`lib/forms/assist-stream.ts`)
 * as it arrives: a `status` event updates the working indicator, `text` deltas
 * accumulate into the in-progress assistant turn, and a terminal `proposal` or `error`
 * event ends the turn. `usage` carries no UI surface - token counts are server-side
 * logging only (SEC-8).
 */
export function AssistPanel({
  endpoint,
  draft,
  draftUpdatedAt,
  onAccept,
}: {
  /** This form's assist route, e.g. `/forms/frm_x/assist` (relative to this app). */
  readonly endpoint: string;
  /** The builder's current working draft - what a proposal is diffed against. */
  readonly draft: DraftForm;
  /** The stored draft's `updatedAt`, sent as `clientState` (a 409 means it moved). */
  readonly draftUpdatedAt: string | undefined;
  /** Accept: the parsed proposed draft, ready for the builder's own save path. */
  readonly onAccept: (proposedDraft: DraftForm) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [conversation, setConversation] = useState<readonly AssistTurn[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [working, setWorking] = useState<WorkingPhase | undefined>(undefined);
  const [streamingText, setStreamingText] = useState("");
  const [proposal, setProposal] = useState<ProposalState | undefined>(undefined);
  const [panelError, setPanelError] = useState<AssistPanelError | undefined>(undefined);
  const [focusToken, setFocusToken] = useState(0);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // Storage may be unavailable (private browsing, disabled). Default stands.
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (proposal !== undefined) headingRef.current?.focus();
  }, [proposal]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Persisting is a nicety; the toggle still works for this visit.
      }
      return next;
    });
  }

  async function send() {
    const content = inputValue.trim();
    if (content === "" || working !== undefined) return;

    const nextConversation = [...conversation, { role: "user" as const, content }];
    setConversation(nextConversation);
    setInputValue("");
    setPanelError(undefined);
    setProposal(undefined);
    setWorking({ phase: "thinking" });

    const controller = new AbortController();
    abortRef.current = controller;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation: nextConversation,
          ...(draftUpdatedAt === undefined ? {} : { clientState: draftUpdatedAt }),
        }),
        signal: controller.signal,
      });
    } catch {
      setWorking(undefined);
      setPanelError({ kind: "PROVIDER_ERROR" });
      return;
    }

    if (!response.ok || response.body === null) {
      setWorking(undefined);
      setPanelError(await errorForResponse(response));
      return;
    }

    let assistantText = "";
    try {
      for await (const event of readAssistEvents(response.body)) {
        handleAssistEvent(event, draft, {
          onWorking: setWorking,
          onText: (delta) => {
            assistantText += delta;
            setStreamingText(assistantText);
          },
          onToolRejected: (tool) => {
            setPanelError({ kind: "TOOL_REJECTED", tool });
          },
          onProposal: setProposal,
          onError: setPanelError,
        });
      }
    } catch {
      setPanelError((current) => current ?? { kind: "PROVIDER_ERROR" });
    } finally {
      setWorking(undefined);
      setStreamingText("");
      if (assistantText !== "") {
        setConversation((current) => [...current, { role: "assistant", content: assistantText }]);
      }
    }
  }

  function accept() {
    if (proposal === undefined) return;
    onAccept(acceptedDraft(draft, proposal.proposal.proposedDraft));
    setProposal(undefined);
    setFocusToken((token) => token + 1);
  }

  function discard() {
    setProposal(undefined);
    setFocusToken((token) => token + 1);
  }

  const statusText = computeStatusText(working, proposal);

  return (
    <aside
      aria-labelledby="qcms-assist-heading"
      data-testid="qcms-assist-panel"
      className="flex flex-col gap-3 rounded-md border border-(--color-border) p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="qcms-assist-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.assist.title")}
        </h2>
        <div data-testid="qcms-assist-toggle">
          <Button variant="ghost" size="sm" onPress={toggleCollapsed}>
            {collapsed ? t("forms.assist.expand") : t("forms.assist.collapse")}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-4">
          <p aria-live="polite" aria-busy={working !== undefined} data-testid="qcms-assist-status">
            {statusText}
          </p>

          {conversation.length === 0 ? (
            <p className="text-sm text-(--color-text-muted)">{t("forms.assist.emptyHint")}</p>
          ) : (
            <ol
              aria-label={t("forms.assist.conversationLabel")}
              data-testid="qcms-assist-conversation"
              className="flex flex-col gap-2 text-sm"
            >
              {conversation.map((turn, index) => (
                <li key={`${turn.role}:${String(index)}`}>
                  <strong>
                    {t(
                      turn.role === "user" ? "forms.assist.turnYou" : "forms.assist.turnAssistant",
                    )}
                    :
                  </strong>{" "}
                  {turn.content}
                </li>
              ))}
              {streamingText !== "" && (
                <li aria-busy="true">
                  <strong>{t("forms.assist.turnAssistant")}:</strong> {streamingText}
                </li>
              )}
            </ol>
          )}

          {panelError !== undefined && (
            <div data-testid="qcms-assist-error">
              <Alert variant="error">{messageForError(panelError)}</Alert>
            </div>
          )}

          {proposal !== undefined && (
            <div data-testid="qcms-assist-proposal">
              <Card padding="md" border>
                <div className="flex flex-col gap-3">
                  <h3
                    ref={headingRef}
                    tabIndex={-1}
                    id="qcms-assist-proposal-heading"
                    className="text-base font-semibold text-(--color-text)"
                  >
                    {t("forms.assist.proposalHeading")}
                  </h3>
                  {proposal.proposal.rationale !== "" && (
                    <p className="text-sm text-(--color-text-muted)">
                      <span className="qcms-visually-hidden">{t("forms.assist.rationale")}: </span>
                      {proposal.proposal.rationale}
                    </p>
                  )}

                  <ul className="flex flex-col gap-2 text-sm" data-testid="qcms-assist-diff">
                    {proposal.diff.length === 0 ? (
                      <li>{t("forms.assist.diffEmpty")}</li>
                    ) : (
                      proposal.diff.map((entry) => (
                        <li key={`${entry.kind}:${entry.id}`}>
                          <details>
                            <summary>{diffLineText(entry)}</summary>
                            <pre className="whitespace-pre-wrap text-xs text-(--color-text-muted)">
                              {entry.detail}
                            </pre>
                          </details>
                        </li>
                      ))
                    )}
                  </ul>

                  <div data-testid="qcms-assist-validation" className="text-sm">
                    {proposal.proposal.issues.length === 0 ? (
                      <p>{t("forms.assist.validationClean")}</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {proposal.proposal.issues.map((issue, index) => (
                          <li key={`${issue.code}:${String(index)}`}>
                            <IssueEntry issue={issue} draft={draft} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <div data-testid="qcms-assist-accept">
                      <Button variant="primary" size="md" onPress={accept}>
                        {t("forms.assist.accept")}
                      </Button>
                    </div>
                    <div data-testid="qcms-assist-discard">
                      <Button variant="secondary" size="md" onPress={discard}>
                        {t("forms.assist.discard")}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div data-testid="qcms-assist-input" className="min-w-0 flex-1">
              <TextField
                key={focusToken}
                label={t("forms.assist.inputLabel")}
                value={inputValue}
                onChange={setInputValue}
                isDisabled={working !== undefined}
                autoFocus={focusToken > 0}
              />
            </div>
            <div data-testid="qcms-assist-send">
              <Button
                variant="primary"
                size="md"
                isDisabled={working !== undefined || inputValue.trim() === ""}
                onPress={() => {
                  void send();
                }}
              >
                {t("forms.assist.send")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

const COLLAPSE_STORAGE_KEY = "qcms-assist-collapsed";

interface WorkingPhase {
  readonly phase: "thinking" | "tool";
  readonly tool?: string;
}

interface ProposalState {
  readonly proposal: AssistProposal;
  readonly diff: readonly DiffEntry[];
}

/** The status line: whichever of "working" or "a proposal just landed" applies. */
function computeStatusText(
  working: WorkingPhase | undefined,
  proposal: ProposalState | undefined,
): string {
  if (working !== undefined) return workingText(working);
  if (proposal !== undefined) return proposalAnnounce(proposal.diff, proposal.proposal.issues);
  return "";
}

/**
 * One SSE event, applied to the panel's state via the callbacks the caller supplies.
 *
 * Pulled out of `send()`'s streaming loop so the loop itself stays a single call per
 * event rather than a five-way branch repeated on every iteration - the branching is
 * exactly the same, it just has a name and a unit boundary now.
 */
function handleAssistEvent(
  event: AssistEvent,
  draft: DraftForm,
  handlers: {
    readonly onWorking: (phase: WorkingPhase) => void;
    readonly onText: (delta: string) => void;
    readonly onToolRejected: (tool: string) => void;
    readonly onProposal: (state: ProposalState) => void;
    readonly onError: (error: AssistPanelError) => void;
  },
): void {
  if (event.type === "status") {
    handlers.onWorking(
      event.tool === undefined ? { phase: event.phase } : { phase: event.phase, tool: event.tool },
    );
  } else if (event.type === "text") {
    handlers.onText(event.delta);
  } else if (event.type === "tool-rejected") {
    handlers.onToolRejected(event.tool);
  } else if (event.type === "proposal") {
    handlers.onProposal({
      proposal: event.proposal,
      diff: proposalDiff(draft, event.proposal.proposedDraft, event.proposal.newQuestions),
    });
  } else if (event.type === "error") {
    handlers.onError({ kind: event.code, message: event.message });
  }
}

type AssistPanelErrorKind =
  AssistErrorCode | "TOOL_REJECTED" | "RATE_LIMITED" | "STALE_DRAFT" | "HTTP";

interface AssistPanelError {
  readonly kind: AssistPanelErrorKind;
  readonly message?: string;
  readonly tool?: string;
  readonly retryAfter?: string;
}

/** The error kinds whose sentence needs no interpolation, keyed to the catalog. */
const SIMPLE_ERROR_MESSAGES: Readonly<
  Record<
    Exclude<AssistPanelErrorKind, "REFUSED" | "TOOL_REJECTED" | "RATE_LIMITED" | "HTTP">,
    MessageKey
  >
> = {
  PROVIDER_ERROR: "forms.assist.error.PROVIDER_ERROR",
  NO_PROPOSAL: "forms.assist.error.NO_PROPOSAL",
  LENGTH: "forms.assist.error.LENGTH",
  STEP_LIMIT: "forms.assist.error.STEP_LIMIT",
  STALE_DRAFT: "forms.assist.error.STALE_DRAFT",
};

function messageForError(error: AssistPanelError): string {
  if (error.kind === "REFUSED") {
    return t("forms.assist.error.REFUSED", { message: error.message ?? "" });
  }
  if (error.kind === "TOOL_REJECTED") {
    return t("forms.assist.error.TOOL_REJECTED", { tool: error.tool ?? "" });
  }
  if (error.kind === "RATE_LIMITED") {
    return error.retryAfter === undefined
      ? t("forms.assist.error.RATE_LIMITED")
      : t("forms.assist.error.RATE_LIMITED_RETRY", { seconds: error.retryAfter });
  }
  if (error.kind === "HTTP") {
    return t("forms.assist.error.HTTP", { message: error.message ?? "" });
  }
  return t(SIMPLE_ERROR_MESSAGES[error.kind]);
}

/** The HTTP-level failures the route relays as-is: 429, 409, and everything else. */
async function errorForResponse(response: Response): Promise<AssistPanelError> {
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    return retryAfter === null ? { kind: "RATE_LIMITED" } : { kind: "RATE_LIMITED", retryAfter };
  }
  if (response.status === 409) return { kind: "STALE_DRAFT" };
  const body: unknown = await response.json().catch(() => undefined);
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return { kind: "HTTP", message: typeof message === "string" ? message : String(response.status) };
}

function workingText(phase: WorkingPhase): string {
  return phase.phase === "tool" && phase.tool !== undefined
    ? t("forms.assist.workingTool", { tool: phase.tool })
    : t("forms.assist.working");
}

/** The completion announcement the same live region carries once a proposal lands. */
function proposalAnnounce(
  diff: readonly DiffEntry[],
  issues: ProposalState["proposal"]["issues"],
): string {
  const changes = tPlural(
    "forms.assist.diffCount.one",
    "forms.assist.diffCount.other",
    diff.length,
  );
  const validation =
    issues.length === 0
      ? t("forms.assist.validationClean")
      : tPlural("forms.validation.countOne", "forms.validation.count", issues.length);
  return `${changes} ${validation}`;
}

const KIND_LABELS: Readonly<Record<DiffEntry["kind"], MessageKey>> = {
  step: "forms.assist.kind.step",
  question: "forms.assist.kind.question",
  rule: "forms.assist.kind.rule",
};

/** One diff line's text, marked `Added`/`Changed` - never colour alone. */
function diffLineText(entry: DiffEntry): string {
  const label = `${t(KIND_LABELS[entry.kind])}: ${entry.label}`;
  return entry.change === "added"
    ? t("forms.assist.diffAdded", { label })
    : t("forms.assist.diffChanged", { label });
}
