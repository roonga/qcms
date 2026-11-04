"use client";

import { useEffect, useState } from "react";

import { AmbientSaveStatus } from "@/components/save-model";
import { useDraftAutosave } from "@/lib/forms/autosave";
import type { PreviewConditionState, SaveDraftState } from "@/lib/forms/builder-state";
import type { ValidateDraftState } from "@/lib/forms/builder-state";
import { blankDraft } from "@/lib/forms/draft";
import { ruleAnchorId } from "@/lib/forms/issues";
import type { DraftForm, FormDetail, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";

import { AgentProvenanceTag } from "./agent-provenance-tag";
import { RulesEditor } from "./rules-editor";
import { SaveNotices } from "./save-notices";

export function RulesScreen({
  detail,
  library,
  verdict,
  saveDraft,
  validateDraft,
  previewCondition,
}: {
  readonly detail: FormDetail;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly verdict?: {
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
  };
  readonly saveDraft: (draft: DraftForm) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
    instances: Record<string, readonly string[]>;
  }) => Promise<PreviewConditionState>;
}) {
  const [draft, setDraft] = useState<DraftForm>(
    detail.draft ?? blankDraft(detail.formId, detail.defaultLocale),
  );
  const [agentAssisted, setAgentAssisted] = useState(detail.draftAgentAssisted);
  const autosave = useDraftAutosave({
    draft,
    saveDraft,
    validateDraft,
    ...(verdict === undefined ? {} : { initialVerdict: verdict }),
    onSaved: (saved) => {
      if (saved.agentAssisted !== undefined) setAgentAssisted(saved.agentAssisted);
    },
  });

  const mutate = (next: DraftForm): void => {
    autosave.markDirty();
    setDraft(next);
  };

  // Focus after switching route; scrolling alone cannot complete an issue jump for keyboard users.
  useEffect(() => {
    const prefix = `#${ruleAnchorId("")}`;
    const hash = window.location.hash;
    if (!hash.startsWith(prefix)) return;
    focusWhenRendered(hash.slice(1));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SaveNotices paused={autosave.paused} saveError={autosave.saveError} />

      {agentAssisted && (
        <div data-testid="qcms-builder-provenance">
          <AgentProvenanceTag />
        </div>
      )}

      <div className="flex justify-end">
        <AmbientSaveStatus
          isSaving={autosave.status === "saving"}
          hasFailed={autosave.saveError !== undefined}
          savedAt={autosave.lastSavedAt}
        />
      </div>

      <RulesEditor
        draft={draft}
        library={library}
        issues={autosave.issues ?? []}
        previewCondition={previewCondition}
        onChange={mutate}
      />
    </div>
  );
}

function focusWhenRendered(anchor: string, attemptsLeft = 3): void {
  requestAnimationFrame(() => {
    const target = document.getElementById(anchor);
    if (target !== null) {
      target.scrollIntoView({ block: "nearest" });
      target.focus();
      return;
    }
    if (attemptsLeft > 0) focusWhenRendered(anchor, attemptsLeft - 1);
  });
}
