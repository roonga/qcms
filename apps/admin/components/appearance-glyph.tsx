import type { Polarity } from "@/lib/appearance";

/**
 * The appearance glyphs: a sun for Light, a crescent moon for Dark, a half-filled
 * monitor for Auto, and a half-disc badge over any of them while high contrast is on.
 *
 * Owned inline SVG, not an icon library, and that is a Code Owner call rather than a
 * bundle-size argument: a handful of paths are cheaper to carry than a dependency, and
 * the design card is the source of truth for their geometry, which an upstream icon set
 * would revise on its own schedule.
 *
 * Nothing here knows a colour: every stroke is `currentColor` off the trigger, and the
 * badge's knockout is a token, so the theme gate holds by construction. They render at
 * 28px inside the 32px hit box, because the avatar beside them is a FILLED 32px disc and
 * a 1.75-weight outline drawn smaller reads as a smaller control next to it.
 *
 * `aria-hidden` on all of it. The trigger's `aria-label` carries the whole state in
 * words, because the glyph is a status cue and not the name of the control.
 */

/** Shared; the viewBox stays 24 units, so every path below is the card's own geometry. */
const SVG_PROPS = {
  viewBox: "0 0 24 24",
  width: 28,
  height: 28,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  "aria-hidden": true,
} as const;

/** Eight rays, drawn as one path so the icon is two elements rather than nine. */
const SUN_RAYS =
  "M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" +
  "M5.64 5.64 7.4 7.4M16.6 16.6l1.76 1.76M5.64 18.36 7.4 16.6M16.6 7.4l1.76-1.76";

function PolarityPaths({ polarity }: { readonly polarity: Polarity }) {
  if (polarity === "dark") {
    return <path d="M15 8 A5 5 0 1 0 15 16 A4 4 0 0 1 15 8 Z" />;
  }
  if (polarity === "light") {
    return (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d={SUN_RAYS} />
      </>
    );
  }
  return (
    <>
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M9 20h6M12 16.5v3.5" />
      {/* Half the screen filled is what says "whichever the machine says" without a
          word, and it survives a two-colour palette. */}
      <path d="M12 6h7.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H12Z" fill="currentColor" stroke="none" />
    </>
  );
}

export function AppearanceGlyph({
  polarity,
  highContrast,
}: {
  readonly polarity: Polarity;
  readonly highContrast: boolean;
}) {
  return (
    <svg {...SVG_PROPS}>
      <PolarityPaths polarity={polarity} />
      {highContrast ? (
        <>
          {/* Its own knocked-out disc, so the badge reads against whatever the polarity
              glyph draws underneath it rather than merging with a ray. */}
          <circle cx="18" cy="18" r="5.5" fill="var(--color-background)" stroke="none" />
          <circle cx="18" cy="18" r="3.75" />
          <path d="M18 14.25 A3.75 3.75 0 0 0 18 21.75 Z" fill="currentColor" stroke="none" />
        </>
      ) : null}
    </svg>
  );
}
