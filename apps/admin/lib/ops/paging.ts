/** Clamp past-end pages with rows to the last page instead of claiming the entire set is empty. Pager links and indicators use the page actually read. */

/** An empty set still displays page one. Floor invalid page sizes to avoid division by zero. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** Do not clamp truly empty results: page one is equally empty and the extra read cannot change the truthful empty state. */
export function clampedPage(
  requested: number,
  total: number,
  pageSize: number,
): number | undefined {
  if (total <= 0) return undefined;
  const last = pageCount(total, pageSize);
  return requested > last ? last : undefined;
}
