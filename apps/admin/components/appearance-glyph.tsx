import type { Polarity } from "@/lib/appearance";

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
          <circle cx="18" cy="18" r="5.5" fill="var(--color-background)" stroke="none" />
          <circle cx="18" cy="18" r="3.75" />
          <path d="M18 14.25 A3.75 3.75 0 0 0 18 21.75 Z" fill="currentColor" stroke="none" />
        </>
      ) : null}
    </svg>
  );
}
