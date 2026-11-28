"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Alert, Button, Tab, TabList, TabPanel, Tabs } from "@/components/kit";
import { AssistIconButton } from "@/components/forms/assist-icon-button";
import { AssistMark } from "@/components/forms/assist-mark";
import { BuilderPreview, type BuilderPreviewSource } from "@/components/forms/builder-preview";
import { SelectedQuestion } from "@/components/forms/selected-question";
import { ConversationProvider, useConversation } from "@/lib/agent/conversation";
import { clearBuilderFacts } from "@/lib/agent/builder-facts-store";
import { builderConversationKey } from "@/lib/agent/conversation-state";
import {
  BUILDER_TABS_QUERY,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_WIDTH_CHOICES,
  PANEL_WIDTH_STEP,
  clampPanelWidth,
} from "@/lib/agent/panel";
import { builderPublishHref, editByHandHref, openPreviewHref } from "@/lib/forms/build-return";
import type { StartDraftState } from "@/lib/forms/builder-state";
import type { DraftForm } from "@/lib/forms/types";
import { useIsHydrated } from "@/lib/hydrated";
import { t, type MessageKey } from "@/lib/i18n/en";
import { setBuilderSubjectName } from "@/lib/shell/builder-subject";
import { NEW_FORM_BUILD_PATH, builderPath } from "@/lib/shell/modes";

import { BuilderAssistant, type BuilderEditActions } from "./builder-assistant";

type PaneKey = "assistant" | "preview";

function subscribeNarrow(listener: () => void): () => void {
  const query = window.matchMedia(BUILDER_TABS_QUERY);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

function isNarrow(): boolean {
  return window.matchMedia(BUILDER_TABS_QUERY).matches;
}

function notNarrowOnServer(): boolean {
  return false;
}

/** What the assistant pane works on: the form, if one exists yet, and how its edits are saved. */
interface AssistantSubject {
  readonly formId: string | null;
  readonly name: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly draft: DraftForm | null;
  readonly edits: BuilderEditActions | undefined;
}

function subjectLabel(subject: AssistantSubject): string {
  return subject.formId === null
    ? t("builder.assistant.subjectNew")
    : t("builder.assistant.subject", { name: subject.name });
}

function AssistantPane({
  subject,
  returnFocusTo,
}: {
  readonly subject: AssistantSubject;
  readonly returnFocusTo: RefObject<HTMLElement | null>;
}) {
  return (
    <div className="qcms-builder__pane-body" data-testid="qcms-builder-assistant">
      <SelectedQuestion returnFocusTo={returnFocusTo} />
      <BuilderAssistant
        formId={subject.formId}
        userId={subject.userId}
        workspaceId={subject.workspaceId}
        draft={subject.draft}
        actions={subject.edits}
      />
    </div>
  );
}

/**
 * The pane's header, in the AssistantPanel's anatomy: the mark names the assistant in place of a
 * title word, the chip names the form, and only the controls a permanent column can honour follow.
 */
function AssistantPaneHead({
  subject,
  chipRef,
  helpOpen,
  onHelpToggle,
  onRestart,
}: {
  readonly subject: AssistantSubject;
  readonly chipRef: RefObject<HTMLSpanElement | null>;
  readonly helpOpen: boolean;
  readonly onHelpToggle: () => void;
  readonly onRestart: () => void;
}) {
  return (
    <div className="qcms-builder__pane-head">
      <h2 id="qcms-builder-assistant-heading" className="qcms-builder__pane-heading">
        <AssistMark size={24} />
      </h2>
      <span
        ref={chipRef}
        tabIndex={-1}
        className="qcms-tag"
        data-testid="qcms-builder-assistant-subject"
      >
        {subjectLabel(subject)}
      </span>
      <div className="qcms-builder__pane-tools">
        <AssistIconButton
          label={t("agent.new")}
          testId="qcms-builder-assistant-new"
          onPress={onRestart}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </AssistIconButton>
        <AssistIconButton
          label={t("agent.help")}
          testId="qcms-builder-assistant-help"
          expanded={helpOpen}
          onPress={onHelpToggle}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3V13" strokeLinecap="round" />
            <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </AssistIconButton>
      </div>
    </div>
  );
}

function PaneWidths({
  width,
  onResize,
}: {
  readonly width: number;
  readonly onResize: (next: number) => void;
}) {
  return (
    <div className="qcms-assistant__help" data-testid="qcms-builder-assistant-help-panel">
      <fieldset className="qcms-assistant__widths">
        <legend>{t("builder.pane.width")}</legend>
        {PANEL_WIDTH_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            className="qcms-railtoggle"
            aria-pressed={width === choice}
            data-testid={`qcms-builder-pane-width-${String(choice)}`}
            onClick={() => {
              onResize(choice);
            }}
          >
            {t(`agent.width.${String(choice)}` as MessageKey)}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function PreviewPane({
  formId,
  source,
}: {
  readonly formId: string | null;
  readonly source: BuilderPreviewSource | undefined;
}) {
  if (formId !== null && source !== undefined && source.draft !== null) {
    return (
      <div
        className="qcms-builder__pane-body qcms-builder__pane-body--preview"
        data-testid="qcms-builder-preview"
      >
        <BuilderPreview formId={formId} draft={source.draft} source={source} />
      </div>
    );
  }
  return (
    <div className="qcms-builder__pane-body" data-testid="qcms-builder-preview">
      <p className="text-sm text-(--color-text-muted)">
        {formId === null ? t("builder.preview.newForm") : t("builder.preview.empty")}
      </p>
    </div>
  );
}

function Panes({
  subject,
  source,
}: {
  readonly subject: AssistantSubject;
  readonly source: BuilderPreviewSource | undefined;
}) {
  const formId = subject.formId;
  const conversation = useConversation();
  const chip = useRef<HTMLSpanElement>(null);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, notNarrowOnServer);
  const [selected, setSelected] = useState<PaneKey>("assistant");
  const [width, setWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const style: CSSProperties & Record<"--qcms-builder-pane-w", string> = {
    "--qcms-builder-pane-w": `${String(width)}px`,
  };

  const resize = (next: number): void => {
    setWidth(clampPanelWidth(next));
  };

  const restart = (): void => {
    conversation.restart();
    setAnnouncement(t("agent.new.announce"));
  };

  // The pane sits at the inline start, so the arrow that points away from the preview widens it.
  const onEdgeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const next: Readonly<Record<string, number>> = {
      ArrowRight: width + PANEL_WIDTH_STEP,
      ArrowLeft: width - PANEL_WIDTH_STEP,
      Home: PANEL_MIN_WIDTH,
      End: PANEL_MAX_WIDTH,
    };
    const asked = next[event.key];
    if (asked === undefined) return;
    event.preventDefault();
    resize(asked);
  };

  const head = (
    <AssistantPaneHead
      subject={subject}
      chipRef={chip}
      helpOpen={helpOpen}
      onHelpToggle={() => {
        setHelpOpen((was) => !was);
      }}
      onRestart={restart}
    />
  );
  const live = (
    <p className="sr-only" aria-live="polite" data-testid="qcms-builder-pane-announce">
      {announcement}
    </p>
  );

  if (narrow) {
    return (
      <Tabs
        className="qcms-builder__tabs"
        selectedKey={selected}
        onSelectionChange={(key) => {
          setSelected(key === "preview" ? "preview" : "assistant");
        }}
      >
        <TabList aria-label={t("builder.panes")} className="qcms-phasetabs qcms-builder__tablist">
          <Tab id="assistant" className="qcms-phasetab">
            {t("builder.pane.assistant")}
          </Tab>
          <Tab id="preview" className="qcms-phasetab">
            {t("builder.pane.preview")}
          </Tab>
        </TabList>
        <TabPanel id="assistant" className="qcms-builder__tabpanel">
          {head}
          <AssistantPane subject={subject} returnFocusTo={chip} />
          {live}
        </TabPanel>
        <TabPanel id="preview" className="qcms-builder__tabpanel">
          <PreviewPane formId={formId} source={source} />
        </TabPanel>
      </Tabs>
    );
  }

  return (
    <div className="qcms-builder__panes" style={style} data-testid="qcms-builder-panes">
      <section
        className="qcms-builder__pane qcms-builder__pane--assistant"
        aria-labelledby="qcms-builder-assistant-heading"
      >
        {head}
        {helpOpen && <PaneWidths width={width} onResize={resize} />}
        <AssistantPane subject={subject} returnFocusTo={chip} />
        {live}
        <div
          className="qcms-builder__pane-edge"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("builder.pane.widthSeparator")}
          aria-valuenow={width}
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          data-testid="qcms-builder-pane-edge"
          onKeyDown={onEdgeKeyDown}
        />
      </section>
      <section
        className="qcms-builder__pane qcms-builder__pane--preview"
        aria-labelledby="qcms-builder-preview-heading"
      >
        <h2 id="qcms-builder-preview-heading" className="qcms-builder__pane-heading">
          {t("builder.pane.preview")}
        </h2>
        <PreviewPane formId={formId} source={source} />
      </section>
    </div>
  );
}

function StartDraft({ start }: { readonly start: () => Promise<StartDraftState> }) {
  const router = useRouter();
  const hydrated = useIsHydrated();
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string>();
  return (
    <section
      className="qcms-builder__start"
      aria-labelledby="qcms-builder-start-heading"
      data-testid="qcms-builder-start-draft"
    >
      <h2 id="qcms-builder-start-heading" className="text-base font-semibold">
        {t("builder.newDraft.heading")}
      </h2>
      <p>{t("builder.newDraft.body")}</p>
      {failed !== undefined && (
        <Alert variant="error">{t("builder.newDraft.failed", { message: failed })}</Alert>
      )}
      <div>
        <Button
          variant="primary"
          size="md"
          isDisabled={!hydrated || isPending}
          onPress={() => {
            setFailed(undefined);
            startTransition(async () => {
              try {
                const result = await start();
                if (result.status === "error") {
                  setFailed(result.message);
                  return;
                }
                router.refresh();
              } catch {
                setFailed("");
              }
            });
          }}
        >
          {isPending ? t("builder.newDraft.starting") : t("builder.newDraft.start")}
        </Button>
      </div>
    </section>
  );
}

function Actions({
  formId,
  canPublish,
}: {
  readonly formId: string | null;
  readonly canPublish: boolean;
}) {
  if (formId === null) {
    return (
      <div className="qcms-builder__actions" data-testid="qcms-builder-actions">
        <p className="text-sm text-(--color-text-muted)">{t("builder.notYetCreated")}</p>
        <Button variant="secondary" size="md" isDisabled>
          {t("builder.editByHand")}
        </Button>
        <Button variant="secondary" size="md" isDisabled>
          {t("builder.openPreview")}
        </Button>
        <Button variant="primary" size="md" isDisabled>
          {t("builder.publish")}
        </Button>
      </div>
    );
  }
  return (
    <div className="qcms-builder__actions" data-testid="qcms-builder-actions">
      <Link
        className="qcms-button-link qcms-button-link--secondary"
        href={editByHandHref(formId)}
        data-testid="qcms-builder-edit-by-hand"
      >
        {t("builder.editByHand")}
      </Link>
      <Link
        className="qcms-button-link qcms-button-link--secondary"
        href={openPreviewHref(formId)}
        data-testid="qcms-builder-open-preview"
      >
        {t("builder.openPreview")}
      </Link>
      {canPublish ? (
        <Link
          className="qcms-button-link"
          href={builderPublishHref(formId)}
          data-testid="qcms-builder-publish"
        >
          {t("builder.publish")}
        </Link>
      ) : (
        <Button variant="primary" size="md" isDisabled>
          {t("builder.publish")}
        </Button>
      )}
    </div>
  );
}

/** The agent builder's frame: the heading row's actions, then the assistant pane beside the preview. */
export function BuilderShell({
  formId,
  name,
  userId,
  workspaceId,
  canPublish,
  preview,
  startDraft,
  draft = null,
  edits,
}: {
  readonly formId: string | null;
  readonly name: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly canPublish: boolean;
  /** The draft the preview renders; absent until the form exists. */
  readonly preview?: BuilderPreviewSource;
  /** Present when the form has no open draft, which has to be started before the builder edits it. */
  readonly startDraft?: () => Promise<StartDraftState>;
  /** The open draft, which names the form on a card. */
  readonly draft?: DraftForm | null;
  /** Present for an existing form: the builder's edits and their Undo save through these. */
  readonly edits?: BuilderEditActions;
}): ReactNode {
  useEffect(() => {
    setBuilderSubjectName(name);
    return () => {
      setBuilderSubjectName("");
      clearBuilderFacts();
    };
  }, [name]);

  return (
    <div className="qcms-builder" data-testid="qcms-builder" data-form-id={formId ?? ""}>
      <div className="qcms-builder__heading">
        <h1 className="sr-only">{t("builder.heading", { name })}</h1>
        <Actions formId={formId} canPublish={canPublish} />
      </div>
      {startDraft === undefined ? (
        <ConversationProvider
          pathname={formId === null ? NEW_FORM_BUILD_PATH : builderPath(formId)}
          userId={userId}
          storageKey={builderConversationKey(userId, workspaceId, formId)}
        >
          <Panes subject={{ formId, name, userId, workspaceId, draft, edits }} source={preview} />
        </ConversationProvider>
      ) : (
        <StartDraft start={startDraft} />
      )}
    </div>
  );
}
