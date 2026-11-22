/* Where a scrolling panel leaves an item it has just been handed. An item is read from its
   top down, but a Confirm below the fold is a decision the reader cannot see, so the foot
   comes into view wherever that does not push the top out of it. */

/** How far to scroll, given the item's offsets inside the panel and the panel's own height. */
export function revealOffset(top: number, bottom: number, height: number): number {
  return Math.min(top, Math.max(bottom - height, 0));
}

/** The same, applied to the live element a panel holds. */
export function revealIn(list: HTMLElement, item: HTMLElement): void {
  const listTop = list.getBoundingClientRect().top;
  const box = item.getBoundingClientRect();
  list.scrollTop += revealOffset(box.top - listTop, box.bottom - listTop, list.clientHeight);
}
