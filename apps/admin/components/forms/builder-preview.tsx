"use client";

import type { Appearance } from "@roonga/qcms-core";
import { A2UIStepRenderer, documentForVisible, type A2UIStepDocument } from "@roonga/qcms-ui";
import { instanceIdOfField } from "@roonga/qcms-ui/repeat-node";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { Alert, Button, Select } from "@/components/kit";
import { usePreviewLocale } from "@/components/locale-context";
import { PreviewSurface } from "@/components/preview-theme-island";
import { layoutFindings, layoutReportFact, selectionFact } from "@/lib/agent/builder-facts";
import {
  clearBuilderFacts,
  publishLayout,
  publishSelection,
  useBuilderFacts,
} from "@/lib/agent/builder-facts-store";
import { QUESTION_ATTRIBUTE, measureStep } from "@/lib/forms/layout-collector";
import {
  INITIAL_LOOK,
  surfaceClasses,
  surfaceTokens,
  type PreviewLook,
} from "@/lib/forms/preview-appearance";
import {
  DEVICE_PRESETS,
  INITIAL_FRAME,
  RESPONSIVE_DEVICE,
  ZOOM_CHOICES,
  canRotate,
  deviceKind,
  frameSize,
  parseDevice,
  parseZoom,
  zoomPercent,
  type FrameState,
  type Size,
} from "@/lib/forms/preview-devices";
import { previewViewNarrowing, previewViews } from "@/lib/forms/preview-views";
import type { DraftForm } from "@/lib/forms/types";
import { t, type MessageKey } from "@/lib/i18n/en";
import type { PreviewTheme } from "@/lib/preview-theme";

import {
  hasVisibleQuestion,
  rosterRecord,
  useDraftPreview,
  type DraftPreviewAction,
} from "./draft-preview";

const FALLBACK_PANE: Size = { width: 1024, height: 768 };

interface Outline {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function outlineOf(wrapper: Element, frame: HTMLElement, scale: number): Outline | undefined {
  const origin = frame.getBoundingClientRect();
  const rects = Array.from(wrapper.children)
    .map((child) => child.getBoundingClientRect())
    .filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    left: (left - origin.left) / scale,
    top: (top - origin.top) / scale,
    width: (right - left) / scale,
    height: (bottom - top) / scale,
  };
}

function questionAt(target: EventTarget | null): Element | undefined {
  return target instanceof Element
    ? (target.closest(`[${QUESTION_ATTRIBUTE}]`) ?? undefined)
    : undefined;
}

function labelOf(wrapper: Element): string {
  const label = wrapper.querySelector("label, legend");
  return (label?.textContent ?? "").replaceAll(/\s+/gu, " ").trim();
}

function useStageSize(): { readonly ref: (node: HTMLDivElement | null) => void; size: Size } {
  const [size, setSize] = useState<Size>(FALLBACK_PANE);
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const ref = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (node === null) return;
    const read = (): void => {
      setSize({ width: node.clientWidth, height: node.clientHeight });
    };
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(node);
  }, []);
  return { ref, size };
}

function PressedButton({
  pressed,
  onPress,
  isDisabled = false,
  children,
}: {
  readonly pressed?: boolean;
  readonly onPress: () => void;
  readonly isDisabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="qcms-railtoggle qcms-builder-preview__toggle"
      aria-pressed={pressed}
      disabled={isDisabled}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

function deviceLabel(key: string): string {
  if (key === RESPONSIVE_DEVICE) return t("builder.preview.device.responsive");
  const preset = DEVICE_PRESETS.find((candidate) => candidate.key === key);
  if (preset === undefined) return key;
  return t("builder.preview.device.preset", {
    name: t(`builder.preview.device.${key}` as MessageKey),
    width: preset.width,
    height: preset.height,
  });
}

export interface BuilderPreviewSource {
  readonly draft: DraftForm | null;
  readonly preview: DraftPreviewAction;
  /** The deployment's respondent theme, which a draft with no appearance previews in. */
  readonly defaultTheme: PreviewTheme;
  readonly appearance: Appearance | null;
}

/** The builder's preview: the draft as a respondent sees it, in a device frame the toolbar drives. */
export function BuilderPreview({
  formId,
  draft,
  source,
}: {
  readonly formId: string;
  readonly draft: DraftForm;
  readonly source: BuilderPreviewSource;
}) {
  const { preview, defaultTheme, appearance } = source;
  const previewLocale = usePreviewLocale();
  const { answers, state, handleChange, clearAnswers } = useDraftPreview(draft, preview);
  const [frame, setFrame] = useState<FrameState>(INITIAL_FRAME);
  const [look, setLook] = useState<PreviewLook>(INITIAL_LOOK);
  const [inspecting, setInspecting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [hovered, setHovered] = useState<Outline>();
  const [selectedOutline, setSelectedOutline] = useState<Outline>();
  const [announcement, setAnnouncement] = useState("");
  const stage = useStageSize();
  const frameRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const facts = useBuilderFacts();

  const size = frameSize(frame, stage.size);
  const percent = zoomPercent(frame, size, stage.size);
  const scale = percent / 100;
  const kind = deviceKind(frame, size);

  const views = useMemo(
    () => previewViews(state.preview?.documents ?? [], state.preview?.flow),
    [state.preview],
  );
  const index = views.length === 0 ? 0 : Math.min(stepIndex, views.length - 1);
  const step = views[index]?.step;
  const served = useMemo(() => rosterRecord(state.preview?.flow.rosters ?? []), [state.preview]);
  const view = previewViewNarrowing(draft, views[index], served);

  useEffect(() => clearBuilderFacts, []);

  const selected = facts.selection;
  const selectedKey =
    selected === undefined ? undefined : `${selected.instanceId ?? ""}/${selected.questionId}`;

  useLayoutEffect(() => {
    const frameNode = frameRef.current;
    if (frameNode === null || selected === undefined) {
      setSelectedOutline(undefined);
      return;
    }
    const wrapper = Array.from(frameNode.querySelectorAll(`[${QUESTION_ATTRIBUTE}]`)).find(
      (candidate) =>
        candidate.getAttribute(QUESTION_ATTRIBUTE) === selected.questionId &&
        instanceIdOfField(candidate.getAttribute("data-qcms-field") ?? "") === selected.instanceId,
    );
    setSelectedOutline(wrapper === undefined ? undefined : outlineOf(wrapper, frameNode, scale));
  }, [selected, selectedKey, scale, size.width, size.height, state.preview, index, look]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null || step === undefined) {
      publishLayout(undefined);
      return undefined;
    }
    const handle = requestAnimationFrame(() => {
      const measured = measureStep(surface, scale);
      publishLayout(
        layoutReportFact({
          formId,
          stepId: step.stepId,
          device: kind,
          viewport: size,
          zoomPercent: percent,
          colorScheme: look.polarity,
          highContrast: look.highContrast,
          pageHeight: measured.pageHeight,
          findings: layoutFindings(measured.questions, size.width),
        }),
      );
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [formId, step, kind, size.width, size.height, percent, look, answers, state.preview, scale]);

  const select = useCallback(
    (wrapper: Element): void => {
      const questionId = wrapper.getAttribute(QUESTION_ATTRIBUTE) ?? "";
      const instanceId = instanceIdOfField(wrapper.getAttribute("data-qcms-field") ?? "");
      if (step === undefined) return;
      const fact = selectionFact({
        formId,
        stepId: step.stepId,
        questionId,
        instanceId,
        device: kind,
        viewport: size,
      });
      if (fact === undefined) return;
      const label = labelOf(wrapper) || questionId;
      publishSelection(fact, label);
      setAnnouncement(t("builder.selection.announce", { label }));
    },
    [formId, step, kind, size],
  );

  const onClickCapture = (event: MouseEvent<HTMLDivElement>): void => {
    if (!inspecting) return;
    event.preventDefault();
    event.stopPropagation();
    const wrapper = questionAt(event.target);
    if (wrapper !== undefined) select(wrapper);
  };

  /* react-aria acts on press rather than click, so inspect has to hold the press back from the control too. */
  const holdPress = (event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>): void => {
    if (!inspecting) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!inspecting || event.key !== "Enter") return;
    const wrapper = questionAt(event.target);
    if (wrapper === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    select(wrapper);
  };

  const onPointerMove = (event: MouseEvent<HTMLDivElement>): void => {
    const frameNode = frameRef.current;
    if (!inspecting || frameNode === null) return;
    const wrapper = questionAt(event.target);
    setHovered(wrapper === undefined ? undefined : outlineOf(wrapper, frameNode, scale));
  };

  const reset = (): void => {
    clearAnswers();
    setStepIndex(0);
  };

  const frameStyle: CSSProperties = {
    inlineSize: `${String(size.width)}px`,
    blockSize: `${String(size.height)}px`,
    transform: scale === 1 ? undefined : `scale(${String(scale)})`,
  };
  const boxStyle: CSSProperties = {
    inlineSize: `${String(Math.round(size.width * scale))}px`,
    blockSize: `${String(Math.round(size.height * scale))}px`,
  };

  return (
    <div
      className="qcms-builder-preview"
      data-testid="qcms-builder-preview-pane"
      data-qcms-layout-fact={facts.layout === undefined ? "" : JSON.stringify(facts.layout)}
    >
      <div
        className="qcms-builder-preview__toolbar"
        role="group"
        aria-label={t("builder.preview.controls")}
      >
        <div className="qcms-builder-preview__select">
          <Select
            label={t("builder.preview.device")}
            value={frame.device}
            items={[RESPONSIVE_DEVICE, ...DEVICE_PRESETS.map((preset) => preset.key)].map(
              (key) => ({ label: deviceLabel(key), value: key }),
            )}
            onChange={(next) => {
              setFrame((current) => ({ ...current, device: parseDevice(next), rotated: false }));
            }}
          />
        </div>
        <p className="qcms-builder-preview__size" data-testid="qcms-builder-preview-size">
          {t("builder.preview.size", { width: size.width, height: size.height })}
        </p>
        <PressedButton
          isDisabled={!canRotate(frame)}
          onPress={() => {
            setFrame((current) => ({ ...current, rotated: !current.rotated }));
          }}
        >
          {t("builder.preview.rotate")}
        </PressedButton>
        <div className="qcms-builder-preview__select">
          <Select
            label={t("builder.preview.zoom")}
            value={frame.zoom}
            items={ZOOM_CHOICES.map((choice) => ({
              label:
                choice === "fit"
                  ? t("builder.preview.zoom.fit", {
                      percent: zoomPercent({ ...frame, zoom: "fit" }, size, stage.size),
                    })
                  : t("builder.preview.zoom.percent", { percent: choice }),
              value: choice,
            }))}
            onChange={(next) => {
              setFrame((current) => ({ ...current, zoom: parseZoom(next) }));
            }}
          />
        </div>
        <div
          className="qcms-builder-preview__group"
          role="group"
          aria-label={t("builder.preview.polarity")}
        >
          <PressedButton
            pressed={look.polarity === "light"}
            onPress={() => {
              setLook((current) => ({ ...current, polarity: "light" }));
            }}
          >
            {t("builder.preview.light")}
          </PressedButton>
          <PressedButton
            pressed={look.polarity === "dark"}
            onPress={() => {
              setLook((current) => ({ ...current, polarity: "dark" }));
            }}
          >
            {t("builder.preview.dark")}
          </PressedButton>
          <PressedButton
            pressed={look.highContrast}
            onPress={() => {
              setLook((current) => ({ ...current, highContrast: !current.highContrast }));
            }}
          >
            {t("builder.preview.highContrast")}
          </PressedButton>
        </div>
        <PressedButton
          pressed={inspecting}
          onPress={() => {
            setInspecting((current) => !current);
            setHovered(undefined);
          }}
        >
          {t("builder.preview.inspect")}
        </PressedButton>
        <div className="qcms-builder-preview__steps">
          <p data-testid="qcms-builder-preview-step">
            {t("builder.preview.stepOf", { index: index + 1, total: Math.max(1, views.length) })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={index === 0}
            onPress={() => {
              setStepIndex(index - 1);
            }}
          >
            {t("builder.preview.previous")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={index >= views.length - 1}
            onPress={() => {
              setStepIndex(index + 1);
            }}
          >
            {t("builder.preview.next")}
          </Button>
        </div>
        <Button variant="ghost" size="sm" onPress={reset}>
          {t("builder.preview.reset")}
        </Button>
      </div>

      <div aria-live="polite" className="qcms-builder-preview__status">
        {inspecting && <p>{t("builder.preview.inspectHint")}</p>}
        {announcement !== "" && <p className="sr-only">{announcement}</p>}
        {state.status === "loading" && <p>{t("builder.preview.loading")}</p>}
        {state.status === "rejected" && <p>{t("builder.preview.unavailable")}</p>}
        {state.status === "error" && (
          <Alert variant="error">
            {t("builder.preview.failed", { message: state.message ?? "" })}
          </Alert>
        )}
      </div>

      <div className="qcms-builder-preview__stage" ref={stage.ref}>
        <div className="qcms-builder-device__box" style={boxStyle}>
          <div
            ref={frameRef}
            className="qcms-builder-device"
            style={frameStyle}
            data-testid="qcms-builder-device"
            data-device={kind}
            data-inspecting={inspecting ? "" : undefined}
            aria-label={t("builder.preview.frame")}
            role="region"
            onClickCapture={onClickCapture}
            onPointerDownCapture={holdPress}
            onPointerUpCapture={holdPress}
            onMouseDownCapture={holdPress}
            onKeyDownCapture={onKeyDownCapture}
            onMouseMove={onPointerMove}
            onMouseLeave={() => {
              setHovered(undefined);
            }}
          >
            <PreviewSurface
              theme={defaultTheme}
              classes={surfaceClasses(look, appearance)}
              tokens={surfaceTokens(look, appearance)}
              surfaceRef={surfaceRef}
            >
              <div className="qcms-builder-device__main">
                <div className="qcms-builder-device__card shadow-sm">
                  {state.preview !== undefined && step !== undefined && (
                    <>
                      <A2UIStepRenderer
                        document={documentForVisible(
                          { stepId: step.stepId, root: step.root as A2UIStepDocument["root"] },
                          state.preview.flow.visibleQuestions,
                        )}
                        values={answers}
                        onChange={handleChange}
                        specVersion={state.preview.a2uiSpecVersion}
                        repeat={{
                          rosters: served,
                          ...(view !== undefined ? { view } : {}),
                          visible: new Set(state.preview.flow.visibleQuestions),
                        }}
                        locale={previewLocale}
                        headingLevelOffset={1}
                      />
                      {!hasVisibleQuestion(
                        draft,
                        step.stepId,
                        state.preview.flow.visibleQuestions,
                        view === undefined
                          ? served
                          : { ...served, [view.groupId]: [view.instanceId] },
                      ) && <p>{t("builder.preview.emptyStep")}</p>}
                    </>
                  )}
                </div>
              </div>
            </PreviewSurface>
            {inspecting && hovered !== undefined && (
              <div
                aria-hidden="true"
                className="qcms-builder-device__outline qcms-builder-device__outline--hover"
                style={{
                  left: hovered.left,
                  top: hovered.top,
                  width: hovered.width,
                  height: hovered.height,
                }}
              />
            )}
            {selectedOutline !== undefined && (
              <div
                aria-hidden="true"
                className="qcms-builder-device__outline"
                data-testid="qcms-builder-selected-outline"
                style={{
                  left: selectedOutline.left,
                  top: selectedOutline.top,
                  width: selectedOutline.width,
                  height: selectedOutline.height,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
