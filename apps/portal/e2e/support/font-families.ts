/** One computed `font-family` or `--font-*` value, as bare family names in order. */
export function families(computedValue: string): readonly string[] {
  return computedValue
    .replaceAll(/\s+/gu, " ")
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/gu, ""))
    .filter((family) => family !== "");
}
