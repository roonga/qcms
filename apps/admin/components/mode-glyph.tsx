import type { Mode } from "@/lib/appearance";

/**
 * The three appearance glyphs: sun, crescent moon, half-filled circle (task 032).
 *
 * Owned inline SVG, not an icon library, and that is a Code Owner call rather than a
 * bundle-size argument: three paths are cheaper to carry than a dependency, and the
 * design card (`plan/admin-theme/ds-navbar.html`, "Appearance mode control") is the
 * source of truth for their geometry, which an upstream icon set would silently
 * revise on its own schedule.
 *
 * Every glyph inherits the trigger's `color` through `stroke="currentColor"`, so
 * nothing here knows a colour and the 055 theme gate stays satisfied by
 * construction. They render at 24px inside the 32px hit box: a thin-stroke icon
 * carries much less optical mass than the account menu's solid 32px disc beside it,
 * so it has to claim more of its box to read at a comparable weight (the card
 * records 22px as visibly too light next to the avatar).
 *
 * `aria-hidden` on every one. The trigger's `aria-label` carries the mode in words,
 * because the glyph is a status cue and not the name of the control.
 *
 * All three glyphs are the card's own geometry as reconciled. The moon and the
 * half-disc were copied from it directly. The sun ran the other way: the card named
 * three glyphs in its prose while its markup only ever demonstrated Dark and High
 * contrast, so this one was authored here in the same idiom (a `r=4` core, eight rays
 * between radius 6.5 and 9, the same stroke weight and caps) and the design seat then
 * adopted it into the card. The card remains the authority for all three - a change to
 * any of them belongs there first.
 */

/**
 * Shared across all three, straight off the card's `<svg>` attributes, with one
 * deliberate departure: the card draws the glyph at 24px inside the 32px hit box and
 * calls that optical parity with the avatar. It is not. The avatar is a **filled**
 * 32px disc and this is a 1.75-weight **outline**, so a filled shape at 32 next to an
 * outline at 24 reads as two different sizes - which is exactly how the Code Owner
 * saw it at the gate (2026-08-01). Drawing at 28 closes most of that gap while
 * keeping the rest state borderless and fill-less, which was its own deliberate
 * decision two passes earlier and is the thing a background would have undone.
 *
 * The viewBox stays 24 units, so every path here is still the card's geometry
 * unscaled - only the rendered size changes.
 */
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

export function ModeGlyph({ mode }: { readonly mode: Mode }) {
  if (mode === "dark") {
    return (
      <svg {...SVG_PROPS}>
        <path d="M15 8 A5 5 0 1 0 15 16 A4 4 0 0 1 15 8 Z" />
      </svg>
    );
  }
  if (mode === "hc") {
    return (
      <svg {...SVG_PROPS}>
        <circle cx="12" cy="12" r="5" />
        {/* The one filled shape in the set: half the disc solid is what says
            "contrast" without a word, and it survives a two-colour palette. */}
        <path d="M12 7 A5 5 0 0 0 12 17 Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d={SUN_RAYS} />
    </svg>
  );
}
