/** Reuse the stateless grapheme segmenter because construction is expensive and cluster boundaries do not require an account locale. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Count grapheme clusters, not UTF-16 units, to avoid splitting emoji surrogate pairs and combining accents. */
function firstGraphemes(source: string, count: number): string {
  const clusters: string[] = [];
  for (const { segment } of GRAPHEMES.segment(source)) {
    clusters.push(segment);
    if (clusters.length === count) break;
  }
  return clusters.join("");
}

/** Use this exact string in both the painted account disc and its accessible name so speech input can target the visible label. */
export function initialsFor(email: string, name?: string): string {
  const source = name !== undefined && name.trim() !== "" ? name : (email.split("@")[0] ?? email);
  const parts = source.split(/[\s._\-+]+/u).filter((part) => part !== "");
  if (parts.length >= 2) {
    return `${firstGraphemes(parts[0] ?? "", 1)}${firstGraphemes(parts[1] ?? "", 1)}`.toUpperCase();
  }
  return firstGraphemes(parts[0] ?? source, 2).toUpperCase();
}
