import { t } from "@/lib/i18n/en";

/**
 * The assistant's mark: the Q of QCMS drawn as a speech bubble wearing a robot
 * visor with two points of light.
 *
 * **Inline SVG rather than an image file**, which is the whole reason it is a
 * component. The bubble and the lights are `color-primary` and the visor is
 * `color-primary-foreground`, so the mark follows the admin's three appearance
 * modes (`lib/appearance.ts`) and whatever a fourth one sets those tokens to. A
 * `.svg` behind an `<img>` cannot read a CSS custom property, so it would need
 * one file per mode and would be wrong in the mode nobody regenerated.
 *
 * **It replaces the word "Assistant"** in the panel header at 24px and beside
 * each assistant turn at 20px, so by default it carries the name itself:
 * `role="img"` with `aria-label` from `agent.title`. Beside visible text that
 * already names the assistant it is `decorative`, and then it is `aria-hidden`
 * so the name is not read twice.
 *
 * **`working` is the turn state**, the same state that drives the panel's polite
 * live region. Motion is therefore never the only signal (WCAG 1.4.1, 4.1.3):
 * the region says so in words at the same moment the visor glows. The animation
 * itself lives in `globals.css` under `[data-working="true"]`, where the
 * reduced-motion query can take it away and leave a static glow.
 */
export function AssistMark({
  size,
  working = false,
  decorative = false,
  id,
}: {
  /** 16 or larger: below that the design system says use the word. */
  readonly size: 20 | 24;
  readonly working?: boolean;
  readonly decorative?: boolean;
  /** For the element the panel's `aria-labelledby` points at. */
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
