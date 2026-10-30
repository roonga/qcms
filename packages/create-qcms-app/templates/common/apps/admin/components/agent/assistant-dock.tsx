"use client";

import { usePathname } from "next/navigation";
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
import { t, type MessageKey } from "@/lib/i18n/en";

/**
 * The assistant's top-bar button and its panel, mounted once by the shell layout on every
 * `(shell)` screen (Q18, issue #1133).
 *
 * The button sits in the top bar's trailing group and the panel is a track of the shell
 * body grid, which are two places in the tree, so the state they share lives in a provider
 * wrapping both and each is a slot. With the flag off the provider is not rendered at all,
 * which is the stance the builder prop took: absent rather than hidden.
 *
 * ## Three modes and no float
 *
 * At and above `--bp-sidebar` the panel is a grid track, so it cannot obscure page content
 * (WCAG 2.2 SC 2.4.11). Expand fills the area below the top bar as a modal dialog, and
 * below `--bp-sidebar` the sheet is one too. One element changes role with its state,
 * which is why it is a `div`: an `aside` cannot take the dialog role.
 *
 * ## One header on every screen, the builder included
 *
 * The header is this component's everywhere. On the builder the body is 080's panel in its
 * hosted mode, so the draft proposal, its diff and its Accept keep working while the
 * title, the context chip and the four controls are the ones every other screen shows.
 *
 * ## The rail between 1024 and 1279 CSS px
 *
 * There a rail, a panel and 640px of content do not fit together, so opening the panel
 * takes #1119's hold on the rail. A hold writes no cookie, so closing the panel returns
 * the operator's own Hide sidebar setting rather than overwriting it (ruling O1).
 */

function modeFor(sheet: boolean, expanded: boolean): AssistantMode {
  if (sheet) return "sheet";
  return expanded ? "expanded" : "dock";
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
  const [open, setOpen] = useState(initial.open);
  const [width, setWidth] = useState(initial.width);
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [working, setWorking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sidebar = useSidebar();
  const hold = sidebar.hold;

  // The viewport decides the sheet and the rail hold, so both are watched rather than read
  // once: a window widened past 1280px must return the rail without a reload.
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
      screen: screenForPath(pathname),
      composerRef,
      show: () => {
        setOpen(true);
        remember({ open: true, width });
        // Opening focuses the composer; navigation between screens never steals focus.
        window.setTimeout(() => composerRef.current?.focus(), 0);
      },
      close: () => {
        setOpen(false);
        setExpanded(false);
        remember({ open: false, width });
        // After the paint that drops the panel, because closing the sheet or the expanded
        // state releases the `inert` the top bar is under: focusing into an inert subtree
        // does nothing at all.
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
    [announcement, expanded, open, pathname, remember, sheet, width, working],
  );

  // `Alt+Shift+A` opens or focuses the panel. A modifier chord, so SC 2.1.4 does not bind
  // it, and it is ignored while a text input outside the panel has focus.
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
      <ConversationProvider pathname={pathname}>{children}</ConversationProvider>
    </AssistantContext.Provider>
  );
}

/** The top bar's trailing group. */
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

/** The shell body's third track. */
export function AssistantPanelSlot() {
  const control = useAssistant();
  const conversation = useConversation();
  const builder = useBuilderAssist();
  const [helpOpen, setHelpOpen] = useState(false);
  const modal = control?.open === true && control.mode !== "dock";

  // The expanded state and the sheet are modal, so everything behind them leaves the tab
  // order and the accessibility tree, which is also what traps focus inside the panel.
  // `inert` is a DOM property rather than a style, so it is set here and not in
  // `globals.css`; the dock is a grid track and takes none of this.
  useEffect(() => {
    const behind = [...document.querySelectorAll<HTMLElement>(".qcms-topbar, .qcms-rail, main")];
    for (const element of behind) element.inert = modal;
    return () => {
      for (const element of behind) element.inert = false;
    };
  }, [modal]);

  if (control === undefined) return null;
  const { mode, width } = control;
  // Closed, the panel stays in the document `hidden` rather than unmounting, because a
  // turn survives the panel closing: that is what puts the "Working" text beside the
  // top-bar button with nothing on screen (ruling O3). `hidden` is `display: none`, so the
  // grid rule in `globals.css` excludes it and the dock takes no track.
  const closed = !control.open;
  const subject =
    builder === undefined ? undefined : builder.draft.title[builder.draft.defaultLocale];

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    if (helpOpen) {
      setHelpOpen(false);
      return;
    }
    // A header tooltip is open, so this Escape is its dismissal and focus must not move
    // (SC 1.4.13). `AssistIconButton`'s own document listener closes it.
    if (document.querySelector('[data-testid="qcms-assist-tip"]') !== null) return;
    event.stopPropagation();
    if (mode === "sheet") {
      control.close();
      return;
    }
    if (mode === "expanded") {
      control.toggleExpanded();
      document.querySelector<HTMLElement>('[data-testid="qcms-assistant-expand"]')?.focus();
      return;
    }
    // In the dock, Escape moves focus back to the page and the dock stays open. The
    // content column is a container rather than a control, so it needs a tab index before
    // it will take programmatic focus at all.
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
        {/* Keyed by the conversation, so New conversation empties the hosted builder panel
            as well as the screen conversation this component owns. */}
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
