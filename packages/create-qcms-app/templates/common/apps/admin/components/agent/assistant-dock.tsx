"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { AssistIconButton } from "@/components/forms/assist-icon-button";
import { AssistMark } from "@/components/forms/assist-mark";
import { AssistantButton } from "@/components/agent/assistant-button";
import { AssistantConversation } from "@/components/agent/assistant-conversation";
import { useSidebar } from "@/components/sidebar-toggle";
import { useBuilderAssist } from "@/lib/agent/builder-assist-bridge";
import { contextChipLabel } from "@/lib/agent/context-chip";
import { ConversationProvider, useConversation } from "@/lib/agent/conversation";
import { screenWithFilters } from "@/lib/agent/screen-filters";
import {
  ASSISTANT_BUTTON_ID,
  PANEL_ID,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_WIDTH_CHOICES,
  PANEL_WIDTH_STEP,
  clampPanelWidth,
  panelCookie,
  type PanelState,
} from "@/lib/agent/panel";
import {
  AssistantContext,
  useAssistant,
  type AssistantControl,
  type AssistantMode,
} from "@/lib/agent/panel-context";
import { screenForPath } from "@/lib/agent/screens";
import { ProposalSeamProvider } from "@/lib/agent/waiting";
import { t, type MessageKey } from "@/lib/i18n/en";

function modeFor(sheet: boolean, expanded: boolean): AssistantMode {
  if (sheet) return "sheet";
  return expanded ? "expanded" : "dock";
}

const TAB_STOPS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function wrapTab(event: ReactKeyboardEvent<HTMLDivElement>): void {
  const panel = document.getElementById(PANEL_ID);
  if (panel === null) return;
  const stops = [...panel.querySelectorAll<HTMLElement>(TAB_STOPS)].filter(
    (element) => element.getClientRects().length > 0,
  );
  const first = stops.at(0);
  const last = stops.at(-1);
  if (first === undefined || last === undefined) return;
  const edge = event.shiftKey ? first : last;
  if (document.activeElement !== edge) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

export function AssistantProvider({
  initial,
  secureCookies,
  children,
}: {
  readonly initial: PanelState;
  readonly secureCookies: boolean;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(initial.open);
  const [width, setWidth] = useState(initial.width);
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [working, setWorking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sidebar = useSidebar();
  const hold = sidebar.hold;

  useEffect(() => {
    const read = (): void => {
      setSheet(window.matchMedia("(max-width: 1023.9px)").matches);
    };
    read();
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
    };
  }, []);

  useEffect(() => {
    const apply = (): void => {
      hold(open && window.matchMedia("(min-width: 1024px) and (max-width: 1279.9px)").matches);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      hold(false);
    };
  }, [open, hold]);

  // Focus in the opening commit; a later task could overwrite the operator's intervening focus move.
  const grabbed = useRef(initial.open);
  useEffect(() => {
    if (!open) {
      grabbed.current = false;
      return;
    }
    if (grabbed.current) return;
    grabbed.current = true;
    composerRef.current?.focus();
  }, [open]);

  const remember = useCallback(
    (next: PanelState) => {
      document.cookie = panelCookie(next, secureCookies);
    },
    [secureCookies],
  );

  const control = useMemo<AssistantControl>(
    () => ({
      open,
      mode: modeFor(sheet, expanded),
      width,
      working,
      announcement,
      screen: screenWithFilters(screenForPath(pathname), search ?? undefined),
      composerRef,
      show: () => {
        setOpen(true);
        remember({ open: true, width });
      },
      close: () => {
        setOpen(false);
        setExpanded(false);
        remember({ open: false, width });
        // Wait for the paint that removes inert before restoring focus; focusing an inert subtree does nothing.
        window.setTimeout(() => document.getElementById(ASSISTANT_BUTTON_ID)?.focus(), 0);
      },
      toggleExpanded: () => {
        setExpanded((was) => !was);
      },
      resize: (next) => {
        const clamped = clampPanelWidth(next);
        setWidth(clamped);
        remember({ open, width: clamped });
      },
      setWorking,
      announce: setAnnouncement,
    }),
    [announcement, expanded, open, pathname, remember, search, sheet, width, working],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || !event.shiftKey || event.key.toLowerCase() !== "a") return;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      const inPanel = document.getElementById(PANEL_ID)?.contains(active) === true;
      if (typing && !inPanel) return;
      event.preventDefault();
      if (open) composerRef.current?.focus();
      else control.show();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [control, open]);

  return (
    <AssistantContext.Provider value={control}>
      <ProposalSeamProvider onReview={control.show}>
        <ConversationProvider pathname={pathname}>{children}</ConversationProvider>
      </ProposalSeamProvider>
    </AssistantContext.Provider>
  );
}

export function AssistantButtonSlot() {
  const control = useAssistant();
  if (control === undefined) return null;
  return (
    <AssistantButton
      open={control.open}
      working={control.working}
      onPress={control.open ? control.close : control.show}
    />
  );
}

export function AssistantPanelSlot() {
  const control = useAssistant();
  const conversation = useConversation();
  const builder = useBuilderAssist();
  const [helpOpen, setHelpOpen] = useState(false);
  const modal = control?.open === true && control.mode !== "dock";

  // Apply inert to every sibling along the panel's path to body so modal behavior covers all underlying
  // content.
  useEffect(() => {
    const panel = document.getElementById(PANEL_ID);
    if (panel === null) return undefined;
    const behind: HTMLElement[] = [];
    for (let node = panel as HTMLElement | null; node !== null && node !== document.body;) {
      const parent: HTMLElement | null = node.parentElement;
      for (const sibling of parent?.children ?? []) {
        if (sibling !== node && sibling instanceof HTMLElement) behind.push(sibling);
      }
      node = parent;
    }
    for (const element of behind) element.inert = modal;
    return () => {
      for (const element of behind) element.inert = false;
    };
  }, [modal]);

  if (control === undefined) return null;
  const { mode, width } = control;
  // Keep the closed panel mounted and hidden so in-progress turns survive closing it.
  const closed = !control.open;
  const subject =
    builder === undefined ? undefined : builder.draft.title[builder.draft.defaultLocale];

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // inert removes background stops but does not wrap focus; keep explicit Tab wrapping inside the modal.
    if (event.key === "Tab" && mode !== "dock") {
      wrapTab(event);
      return;
    }
    if (event.key !== "Escape") return;
    if (helpOpen) {
      setHelpOpen(false);
      return;
    }
    const tip = document.querySelector('[data-testid="qcms-assist-tip"]') !== null;
    event.stopPropagation();
    // Let an open tooltip consume Escape before an action that moves focus, preserving hover-content dismissal
    // behavior.
    if (mode === "expanded") {
      control.toggleExpanded();
      document.querySelector<HTMLElement>('[data-testid="qcms-assistant-expand"]')?.focus();
      return;
    }
    if (tip) return;
    if (mode === "sheet") {
      control.close();
      return;
    }
    // The content container needs a temporary tab index before Escape can return focus to it.
    const main = document.querySelector<HTMLElement>("main");
    if (main === null) return;
    main.tabIndex = -1;
    main.focus();
  };

  const onSeparatorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const next: Readonly<Record<string, number>> = {
      ArrowLeft: width + PANEL_WIDTH_STEP,
      ArrowRight: width - PANEL_WIDTH_STEP,
      Home: PANEL_MIN_WIDTH,
      End: PANEL_MAX_WIDTH,
    };
    const asked = next[event.key];
    if (asked === undefined) return;
    event.preventDefault();
    control.resize(asked);
  };

  return (
    <div
      id={PANEL_ID}
      className="qcms-assistant"
      data-testid="qcms-assistant-panel"
      data-mode={mode}
      hidden={closed}
      role={mode === "dock" ? "complementary" : "dialog"}
      aria-modal={mode === "dock" ? undefined : true}
      aria-labelledby={`${PANEL_ID}-name`}
      onKeyDown={onKeyDown}
      style={mode === "dock" ? { inlineSize: `${String(width)}px` } : undefined}
    >
      {mode === "dock" && (
        <div
          className="qcms-assistant__edge"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("agent.width.separator")}
          aria-valuenow={width}
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          data-testid="qcms-assistant-edge"
          onKeyDown={onSeparatorKeyDown}
        />
      )}
      <div className="qcms-assistant__header">
        <AssistMark size={24} working={control.working} id={`${PANEL_ID}-name`} />
        <span className="qcms-tag" data-testid="qcms-assistant-context">
          {contextChipLabel(control.screen, subject)}
        </span>
        <div className="qcms-assistant__controls">
          <AssistIconButton
            label={t("agent.new")}
            testId="qcms-assistant-new"
            onPress={() => {
              conversation.restart();
              control.announce(t("agent.new.announce"));
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </AssistIconButton>
          {mode !== "sheet" && (
            <AssistIconButton
              label={t("agent.expand")}
              testId="qcms-assistant-expand"
              pressed={mode === "expanded"}
              controls={PANEL_ID}
              onPress={control.toggleExpanded}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 9V4h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </AssistIconButton>
          )}
          <AssistIconButton
            label={t("agent.help")}
            testId="qcms-assistant-help"
            expanded={helpOpen}
            onPress={() => {
              setHelpOpen((was) => !was);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3V13" strokeLinecap="round" />
              <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
            </svg>
          </AssistIconButton>
          <AssistIconButton
            label={t("agent.close")}
            testId="qcms-assistant-close"
            onPress={control.close}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </AssistIconButton>
        </div>
      </div>
      {helpOpen && (
        <div className="qcms-assistant__help" data-testid="qcms-assistant-help-panel">
          <p>{t("agent.help.shortcut")}</p>
          <fieldset className="qcms-assistant__widths">
            <legend>{t("agent.width.legend")}</legend>
            {PANEL_WIDTH_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                className="qcms-railtoggle"
                aria-pressed={width === choice}
                data-testid={`qcms-assistant-width-${String(choice)}`}
                onClick={() => {
                  control.resize(choice);
                }}
              >
                {t(`agent.width.${String(choice)}` as MessageKey)}
              </button>
            ))}
          </fieldset>
        </div>
      )}
      <div className="qcms-assistant__body">
        <AssistantConversation
          key={conversation.id}
          screen={control.screen}
          conversation={conversation}
          builder={builder}
          composerRef={control.composerRef}
          onWorkingChange={control.setWorking}
          onAnnounce={control.announce}
        />
      </div>
      <p
        className="qcms-visually-hidden"
        role="status"
        data-testid="qcms-assistant-live"
        aria-busy={control.working}
      >
        {control.announcement}
      </p>
    </div>
  );
}
