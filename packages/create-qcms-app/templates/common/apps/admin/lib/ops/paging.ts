/**
 * What a paged admin table does with a page number past the end of its result set
 * (issue #550).
 *
 * ## The defect this exists to remove
 *
 * `/forms/{id}/responses?page=99` on a form with one page of results rendered the empty
 * table and, under it, "Nothing has been submitted to this form yet." - on a form that
 * plainly has submissions. The operator was told the form was empty when they were
 * simply past the end.
 *
 * It is the same family of false statement issue 521 fixed and it arrives by a different
 * route, which is why that fix does not reach it. 521 made the filtered-versus-unfiltered
 * empty message key off VALIDATED FILTERS, and a page is not a filter: it is a position
 * within a result set rather than a claim about which rows are in it. An out-of-range
 * page is also perfectly valid input, so validation has nothing to say about it either.
 *
 * ## Clamping, rather than a third empty state
 *
 * Issue #550 poses exactly two answers and this module implements the second. The first
 * is a distinct past-the-end message ("there is nothing on this page", with a way back to
 * the first). The issue argues against introducing it now, on its own reasoning: it is a
 * NEW USER-FACING STATE, and issue #514 owns harmonising the two empty-state shapes the
 * admin already has against the frozen design card, so a third one bolted on beforehand
 * leaves #514 inheriting three inconsistent shapes instead of two. Clamping needs no new
 * state at all - it removes the false statement rather than rewording it - and the issue
 * records it as what most operators want.
 *
 * The cost clamping carries is stated there too and is accepted here: the URL lies
 * slightly, because the address says 99 while the view shows page 3. That is the smaller
 * untruth of the two, and it is one the pager itself corrects on screen, since the page
 * indicator and the page links are built from the page that was actually read.
 *
 * ## One rule for every paged table, which is the part that outlives this screen
 *
 * The issue asks that the answer be "chosen once for every paged table in the admin
 * rather than per screen". The response browser is the only paged table today
 * (`grep pageSize` reaches this module, `lib/ops/types.ts` and `response-browser.tsx`
 * and nothing else), so this module is the rule written down before there is a second
 * table to disagree with it, not a shared helper factored out of two.
 */

/**
 * How many pages a result set has, at least one.
 *
 * One page for an empty set rather than zero: "Page 1 of 0" is not a thing a reader can
 * make sense of, and a set with no rows still has a first page - it is the page they are
 * looking at. A `pageSize` of zero or less is floored to one so a malformed payload
 * cannot produce a division by zero or an infinite page count.
 */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/**
 * The page to read instead, when the requested one is past the end of a result set that
 * has rows; `undefined` when the request needs no correction.
 *
 * `undefined` for an EMPTY result set is the load-bearing half. A form nobody has
 * answered, and a filter nothing matches, both legitimately have no rows on any page, and
 * their empty messages are true statements: clamping there would re-read page 1 to
 * discover the same emptiness and change nothing. So the clamp fires only where the
 * screen would otherwise make a false claim, which is the case where rows exist and the
 * operator is standing past them.
 */
export function clampedPage(
  requested: number,
  total: number,
  pageSize: number,
): number | undefined {
  if (total <= 0) return undefined;
  const last = pageCount(total, pageSize);
  return requested > last ? last : undefined;
}
