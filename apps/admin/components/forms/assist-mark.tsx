import { t } from "@/lib/i18n/en";

/**
 * The assistant's mark. Inline SVG so the fills follow the theme tokens in every appearance mode.
 * Named by `agent.title` unless `decorative`; `working` mirrors the live region's turn state.
 */
export function AssistMark({
  size,
  working = false,
  decorative = false,
  id,
}: {
  readonly size: 20 | 24;
  readonly working?: boolean;
  readonly decorative?: boolean;
  readonly id?: string;
}) {
  const naming = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": t("agent.title") } as const);
  return (
    <svg
      {...naming}
      id={id}
      className="qcms-assist-mark"
      data-working={working ? "true" : undefined}
      data-testid="qcms-assist-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
    >
      <path
        className="qcms-assist-mark__bubble"
        d="M12 2.5a9.5 9.5 0 1 0 5.6 17.2l3.9 1.8-1.2-4.1A9.5 9.5 0 0 0 12 2.5z"
      />
      <rect
        className="qcms-assist-mark__visor"
        x="5.6"
        y="8.6"
        width="12.8"
        height="5.2"
        rx="2.6"
      />
      <rect className="qcms-assist-mark__light" x="8" y="10.2" width="2.6" height="2" rx="1" />
      <rect className="qcms-assist-mark__light" x="13.4" y="10.2" width="2.6" height="2" rx="1" />
    </svg>
  );
}
