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
  type ReactNode,
} from "react";

import { Alert, Button, Tab, TabList, TabPanel, Tabs } from "@/components/kit";
import { BuilderPreview, type BuilderPreviewSource } from "@/components/forms/builder-preview";
import { SelectedQuestion } from "@/components/forms/selected-question";
import { ConversationProvider } from "@/lib/agent/conversation";
import { clearBuilderFacts } from "@/lib/agent/builder-facts-store";
import { builderConversationKey } from "@/lib/agent/conversation-state";
import { BUILDER_PANE_WIDTH, BUILDER_TABS_QUERY } from "@/lib/agent/panel";
import { builderPublishHref, editByHandHref, sharePreviewHref } from "@/lib/forms/build-return";
import type { StartDraftState } from "@/lib/forms/builder-state";
import type { DraftForm } from "@/lib/forms/types";
import { useIsHydrated } from "@/lib/hydrated";
import { t } from "@/lib/i18n/en";
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
  readonly workspaceId: string;
  readonly draft: DraftForm | null;
  readonly edits: BuilderEditActions | undefined;
}

function AssistantPane({ subject }: { readonly subject: AssistantSubject }) {
  const heading = useRef<HTMLParagraphElement>(null);
  return (
    <div className="qcms-builder__pane-body" data-testid="qcms-builder-assistant">
      <p
        ref={heading}
        tabIndex={-1}
        className="text-sm text-(--color-text-muted)"
        data-testid="qcms-builder-assistant-subject"
      >
        {subject.formId === null
          ? t("builder.assistant.subjectNew")
          : t("builder.assistant.subject", { name: subject.name })}
      </p>
      <SelectedQuestion returnFocusTo={heading} />
      <BuilderAssistant
        formId={subject.formId}
        workspaceId={subject.workspaceId}
        draft={subject.draft}
        actions={subject.edits}
      />
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
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, notNarrowOnServer);
  const [selected, setSelected] = useState<PaneKey>("assistant");
  const style: CSSProperties & Record<"--qcms-builder-pane-w", string> = {
    "--qcms-builder-pane-w": `${String(BUILDER_PANE_WIDTH)}px`,
  };

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
          <AssistantPane subject={subject} />
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
        <h2 id="qcms-builder-assistant-heading" className="qcms-builder__pane-heading">
          {t("builder.pane.assistant")}
        </h2>
        <AssistantPane subject={subject} />
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
          {t("builder.sharePreview")}
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
        href={sharePreviewHref(formId)}
        data-testid="qcms-builder-share-preview"
      >
        {t("builder.sharePreview")}
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
          <Panes subject={{ formId, name, workspaceId, draft, edits }} source={preview} />
        </ConversationProvider>
      ) : (
        <StartDraft start={startDraft} />
      )}
    </div>
  );
}
