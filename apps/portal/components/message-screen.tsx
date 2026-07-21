import type { ReactNode } from "react";

import { PortalShell } from "@/components/portal-shell";

export type MessageTone = "neutral" | "error" | "success";

const TONE_ICON_CLASS: Record<MessageTone, string> = {
  neutral: "bg-(--color-info-subtle) text-(--color-info-fg)",
  error: "bg-(--color-danger-subtle) text-(--color-danger-fg)",
  success: "bg-(--color-success-subtle) text-(--color-success-fg)",
};

const TONE_GLYPH: Record<MessageTone, string> = {
  neutral: "i",
  error: "!",
  success: "✓",
};

/**
 * A single-message screen (wireframe companion screens: link errors, form-closed,
 * resume-recovery, expired). Error-tone screens carry `role="alert"` per the
 * wireframe's typed-error pages. Structure is kept sound for 030's a11y pass.
 */
export function MessageScreen({
  tone,
  title,
  body,
  children,
}: {
  readonly tone: MessageTone;
  readonly title: string;
  readonly body: string;
  readonly children?: ReactNode;
}) {
  return (
    <PortalShell>
      <div
        className="flex flex-col items-start gap-4"
        {...(tone === "error" ? { role: "alert" } : {})}
      >
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold ${TONE_ICON_CLASS[tone]}`}
        >
          {TONE_GLYPH[tone]}
        </span>
        <h1 className="text-xl font-semibold text-(--color-text)">{title}</h1>
        <p className="text-sm leading-relaxed text-(--color-text-muted)">{body}</p>
        {children}
      </div>
    </PortalShell>
  );
}
