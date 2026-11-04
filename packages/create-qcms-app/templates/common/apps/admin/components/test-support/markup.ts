/* Scan tags without reassembling delimiter fragments; this is test markup extraction, not an HTML
   sanitizer. */
export function stripTags(markup: string): string {
  const text: string[] = [];
  let index = 0;
  for (;;) {
    const open = markup.indexOf("<", index);
    if (open === -1) {
      text.push(markup.slice(index));
      return text.join("");
    }
    text.push(markup.slice(index, open));
    const close = markup.indexOf(">", open + 1);
    if (close === -1) return text.join("");
    index = close + 1;
  }
}
