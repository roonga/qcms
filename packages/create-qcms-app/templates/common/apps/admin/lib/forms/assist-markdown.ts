/**
 * The Markdown subset the assistant panel renders, parsed to plain data.
 *
 * Model prose arrives as Markdown, and shown as plain text it reads as stray asterisks and
 * backticks. A full Markdown renderer is a runtime dependency and a security-sensitive
 * parser; the panel needs very little of one, so this is a small in-house subset (the
 * Code Owner's working default for phase A of `plan/agent-everywhere.md`, which records
 * the dependency alternative as its Q14).
 *
 * ## What it understands
 *
 * Paragraphs, line breaks inside a paragraph, `**bold**`, `*italic*`, `` `inline code` ``,
 * fenced code blocks, and bullet and numbered lists. A `#` heading becomes a bold
 * paragraph rather than a heading element, so model text can never enter the page's
 * heading outline.
 *
 * ## What it refuses, and why it is safe by construction
 *
 * The output is a tree of strings and five inline kinds. Nothing here produces markup:
 * the renderer hands every string to React as a text child, so raw HTML such as
 * `<script>` or `<img onerror>` is shown as the literal characters it is. An image
 * (`![alt](url)`) always becomes its alt text and its URL is dropped, which is the
 * control against the classic exfiltration channel: a URL the browser fetches with no
 * click. The admin CSP is defence in depth behind it.
 *
 * ## Links, and the closed page-route list
 *
 * A link survives as a link in exactly one case: its target is a same-origin path that matches an admin **page** route on
 * {@link ADMIN_PAGE_ROUTES}, with no query string and no fragment. Everything else -
 * an external URL, a `javascript:` target, a protocol-relative path, a path carrying a
 * query or a fragment, and any path not on the list - renders as the link's text, as it
 * did before the rule existed.
 *
 * The list is **a closed list of route patterns, not a prefix test**, because the one
 * target that must never become a link looks exactly like one that may: `/forms/frm_x`
 * is a page and `/forms/frm_x/export` is the streaming download route handler, which
 * only an export card may start (083, D4). A prefix test would let a link begin that
 * download. Task 082 replaces this constant with its screen table and deletes it.
 *
 * Underscores only mark emphasis at a word boundary, so identifiers such as
 * `q_vehicle_make` are never italicised in the middle.
 */

export type MarkdownInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly MarkdownInline[] }
  | { readonly kind: "em"; readonly children: readonly MarkdownInline[] }
  /** A link to an admin page route. `href` has already passed {@link adminPageHref}. */
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly MarkdownInline[];
    };

/**
 * Every admin **page** route under `apps/admin/app/(shell)/`, as it stood when
 * this landed. A `[segment]` matches one path segment.
 *
 * Route handlers are deliberately absent, which is the point of the list:
 * `forms/[formId]/export`, `forms/[formId]/assist`, `settings/password` and
 * `settings/recovery-codes` are not pages, so no link can reach them. Task 082
 * replaces this with `lib/agent/screens.ts` and deletes it.
 */
export const ADMIN_PAGE_ROUTES: readonly string[] = [
  "/forms",
  "/forms/new",
  "/forms/[formId]",
  "/forms/[formId]/rules",
  "/forms/[formId]/preview",
  "/forms/[formId]/versions",
  "/forms/[formId]/versions/[version]",
  "/forms/[formId]/releases",
  "/forms/[formId]/links",
  "/forms/[formId]/webhooks",
  "/forms/[formId]/responses",
  "/forms/[formId]/responses/[sessionId]",
  "/questions",
  "/questions/new",
  "/questions/[questionId]",
  "/responses",
  "/responses/erasures",
  "/webhooks",
  "/workspaces",
  "/workspaces/[workspaceId]",
  "/settings",
];

/** A path segment safe to put in an `href`: no traversal, no encoding tricks. */
const SEGMENT = /^[A-Za-z0-9._~-]+$/u;

function matchesPattern(pattern: string, segments: readonly string[]): boolean {
  const expected = pattern.slice(1).split("/");
  if (expected.length !== segments.length) return false;
  return expected.every((part, index) => (part.startsWith("[") ? true : part === segments[index]));
}

/**
 * The `href` a link target may keep, or `undefined` when it must render as text.
 *
 * A fragment is refused alongside a query string: the rule is that the target is
 * one whole admin page and nothing more, and a fragment is a second thing the
 * model chose about where the reader lands.
 */
export function adminPageHref(target: string): string | undefined {
  const path = target.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  if (path.includes("?") || path.includes("#")) return undefined;
  const segments = path.slice(1).split("/");
  if (!segments.every((segment) => SEGMENT.test(segment) && segment !== "..")) return undefined;
  return ADMIN_PAGE_ROUTES.some((pattern) => matchesPattern(pattern, segments)) ? path : undefined;
}

export type MarkdownBlock =
  | {
      readonly kind: "paragraph";
      /** One entry per source line; the renderer puts a line break between them. */
      readonly lines: readonly (readonly MarkdownInline[])[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      /** The first item's number, for an ordered list that does not start at 1. */
      readonly start: number;
      readonly items: readonly (readonly MarkdownInline[])[];
    }
  | { readonly kind: "code"; readonly text: string };

const ESCAPABLE = new Set("\\`*_{}[]()#+-.!>~|".split(""));

interface ListLine {
  readonly ordered: boolean;
  readonly start: number;
  readonly text: string;
}

/** A fence's marker (three or more backticks or tildes) when `line` opens one. */
function fenceMarker(line: string): string | undefined {
  const trimmed = line.trimStart();
  const char = trimmed[0];
  if (char !== "`" && char !== "~") return undefined;
  let run = 0;
  while (trimmed[run] === char) run += 1;
  return run >= 3 ? char.repeat(run) : undefined;
}

function listLine(line: string): ListLine | undefined {
  const trimmed = line.trimStart();
  if (/^[-*+]\s/u.test(trimmed)) return { ordered: false, start: 1, text: trimmed.slice(2).trim() };
  const ordered = /^(\d{1,9})[.)]\s/u.exec(trimmed);
  if (ordered === null) return undefined;
  return {
    ordered: true,
    start: Number(ordered[1]),
    text: trimmed.slice(ordered[0].length).trim(),
  };
}

/** A `#` heading's text, or `undefined` when the line is not one. */
function headingText(line: string): string | undefined {
  if (line.length - line.trimStart().length > 3) return undefined;
  const trimmed = line.trim();
  let level = 0;
  while (trimmed[level] === "#") level += 1;
  if (level < 1 || level > 6 || !/\s/u.test(trimmed[level] ?? "")) return undefined;
  const text = trimmed.slice(level).trim();
  let cut = text.length;
  while (cut > 0 && text[cut - 1] === "#") cut -= 1;
  const stripped = text.slice(0, cut);
  return stripped === "" || /\s$/u.test(stripped) ? stripped.trim() : text;
}

/** Accumulates blocks; a paragraph and a list each stay open until something ends them. */
class BlockBuilder {
  readonly blocks: MarkdownBlock[] = [];
  private paragraph: string[] = [];
  private list: { ordered: boolean; start: number; items: string[] } | undefined;

  flush(): void {
    this.flushParagraph();
    this.flushList();
  }

  addCode(text: string): void {
    this.flush();
    this.blocks.push({ kind: "code", text });
  }

  addListItem(item: ListLine): void {
    this.flushParagraph();
    if (this.list !== undefined && this.list.ordered !== item.ordered) this.flushList();
    this.list ??= { ordered: item.ordered, start: item.start, items: [] };
    this.list.items.push(item.text);
  }

  /** An indented line under a list item continues that item. */
  continueListItem(line: string): boolean {
    if (this.list === undefined || !/^\s/u.test(line)) return false;
    const last = this.list.items.length - 1;
    this.list.items[last] = `${this.list.items[last] ?? ""} ${line.trim()}`;
    return true;
  }

  addHeading(text: string): void {
    this.flush();
    this.blocks.push({
      kind: "paragraph",
      lines: [[{ kind: "strong", children: parseInline(text) }]],
    });
  }

  addParagraphLine(line: string): void {
    this.flushList();
    this.paragraph.push(line.trim());
  }

  private flushParagraph(): void {
    if (this.paragraph.length === 0) return;
    this.blocks.push({ kind: "paragraph", lines: this.paragraph.map(parseInline) });
    this.paragraph = [];
  }

  private flushList(): void {
    if (this.list === undefined) return;
    const { ordered, start, items } = this.list;
    this.blocks.push({ kind: "list", ordered, start, items: items.map(parseInline) });
    this.list = undefined;
  }
}

/** Parse model prose into blocks. Pure; never throws. */
export function parseSafeMarkdown(source: string): readonly MarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const builder = new BlockBuilder();
  let index = 0;
  while (index < lines.length) index = consumeLine(lines, index, builder);
  builder.flush();
  return builder.blocks;
}

/** Read the block construct starting at `lines[index]`; returns the next line to read. */
function consumeLine(lines: readonly string[], index: number, builder: BlockBuilder): number {
  const line = lines[index] ?? "";
  const marker = fenceMarker(line);
  if (marker !== undefined) {
    const body: string[] = [];
    let next = index + 1;
    while (next < lines.length && !(lines[next] ?? "").trim().startsWith(marker)) {
      body.push(lines[next] ?? "");
      next += 1;
    }
    builder.addCode(body.join("\n"));
    return next + 1;
  }
  if (line.trim() === "") {
    builder.flush();
    return index + 1;
  }
  const item = listLine(line);
  if (item !== undefined) builder.addListItem(item);
  else if (!builder.continueListItem(line)) {
    const heading = headingText(line);
    if (heading === undefined) builder.addParagraphLine(line);
    else builder.addHeading(heading);
  }
  return index + 1;
}

/** One inline construct: literal text to append, or nodes to emit, and where it ends. */
type InlineStep =
  | { readonly text: string; readonly end: number }
  | { readonly nodes: readonly MarkdownInline[]; readonly end: number };

type InlineReader = (source: string, index: number) => InlineStep | undefined;

const readEscape: InlineReader = (source, index) => {
  const next = source[index + 1] ?? "";
  return source[index] === "\\" && ESCAPABLE.has(next) ? { text: next, end: index + 2 } : undefined;
};

const readCodeSpan: InlineReader = (source, index) => {
  if (source[index] !== "`") return undefined;
  let run = 1;
  while (source[index + run] === "`") run += 1;
  const fence = "`".repeat(run);
  const close = source.indexOf(fence, index + run);
  if (close === -1) return { text: fence, end: index + run };
  return {
    nodes: [{ kind: "code", text: source.slice(index + run, close).trim() }],
    end: close + run,
  };
};

/** An image is never rendered: its alt text stands in for it, and its URL is gone. */
const readImage: InlineReader = (source, index) => {
  if (source[index] !== "!" || source[index + 1] !== "[") return undefined;
  const link = readLink(source, index + 1);
  return link === undefined ? undefined : { text: link.label, end: link.end };
};

/**
 * A link, as an anchor only when its target is an admin page route; otherwise
 * its text alone, with the target dropped.
 */
const readLinkText: InlineReader = (source, index) => {
  if (source[index] !== "[") return undefined;
  const link = readLink(source, index);
  if (link === undefined) return undefined;
  const children = parseInline(link.label);
  const href = adminPageHref(link.target);
  return href === undefined
    ? { nodes: children, end: link.end }
    : { nodes: [{ kind: "link", href, children }], end: link.end };
};

const readEmphasisSpan: InlineReader = (source, index) => {
  const char = source[index];
  if (char !== "*" && char !== "_") return undefined;
  const doubled = source[index + 1] === char;
  const marker = doubled ? char + char : char;
  const close = emphasisClose(source, index, marker);
  if (close === undefined) return { text: marker, end: index + marker.length };
  const children = parseInline(source.slice(index + marker.length, close));
  return {
    nodes: [doubled ? { kind: "strong", children } : { kind: "em", children }],
    end: close + marker.length,
  };
};

const INLINE_READERS: readonly InlineReader[] = [
  readEscape,
  readCodeSpan,
  readImage,
  readLinkText,
  readEmphasisSpan,
];

function readInlineStep(source: string, index: number): InlineStep {
  for (const reader of INLINE_READERS) {
    const step = reader(source, index);
    if (step !== undefined) return step;
  }
  return { text: source[index] ?? "", end: index + 1 };
}

/** One line of inline Markdown: code spans, emphasis, and links or images as text. */
export function parseInline(source: string): readonly MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let text = "";
  let index = 0;
  while (index < source.length) {
    const step = readInlineStep(source, index);
    if ("nodes" in step) {
      if (text !== "") out.push({ kind: "text", text });
      text = "";
      out.push(...step.nodes);
    } else {
      text += step.text;
    }
    index = step.end;
  }
  if (text !== "") out.push({ kind: "text", text });
  return out;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** Where the emphasis span opened at `start` closes, or `undefined` if it is not one. */
function emphasisClose(source: string, start: number, marker: string): number | undefined {
  const contentStart = start + marker.length;
  const first = source[contentStart];
  if (first === undefined || /\s/u.test(first)) return undefined;
  const underscore = marker.startsWith("_");
  if (underscore && isWordChar(source[start - 1])) return undefined;
  let close = source.indexOf(marker, contentStart + 1);
  while (close !== -1) {
    if (isEmphasisCloser(source, close, marker, underscore)) return close;
    close = source.indexOf(marker, close + 1);
  }
  return undefined;
}

function isEmphasisCloser(
  source: string,
  close: number,
  marker: string,
  underscore: boolean,
): boolean {
  const before = source[close - 1];
  const after = source[close + marker.length];
  if (before === undefined || /\s/u.test(before)) return false;
  if (marker === "*" && (after === "*" || before === "*")) return false;
  return !(underscore && isWordChar(after));
}

/** `[label](target)` at `start`: the label, the raw target, and where it ends. */
function readLink(
  source: string,
  start: number,
): { label: string; target: string; end: number } | undefined {
  const closeLabel = source.indexOf("]", start + 1);
  if (closeLabel === -1 || source[closeLabel + 1] !== "(") return undefined;
  // The target may carry its own balanced parentheses, as `javascript:alert(1)` does.
  let depth = 1;
  for (let index = closeLabel + 2; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") depth -= 1;
    if (depth === 0) {
      return {
        label: source.slice(start + 1, closeLabel),
        target: source.slice(closeLabel + 2, index),
        end: index + 1,
      };
    }
  }
  return undefined;
}
