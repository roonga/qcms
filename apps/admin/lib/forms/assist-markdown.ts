// Render strings through React, never raw HTML. Drop image URLs to prevent automatic exfiltration; permit only closed-list admin page links. Model headings must not enter the page heading outline.

import { adminPageHref } from "../agent/screens";

export type MarkdownInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly MarkdownInline[] }
  | { readonly kind: "em"; readonly children: readonly MarkdownInline[] }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly MarkdownInline[];
    };

export type MarkdownBlock =
  | {
      readonly kind: "paragraph";

      readonly lines: readonly (readonly MarkdownInline[])[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;

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

export function parseSafeMarkdown(source: string): readonly MarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const builder = new BlockBuilder();
  let index = 0;
  while (index < lines.length) index = consumeLine(lines, index, builder);
  builder.flush();
  return builder.blocks;
}

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

// Drop image URLs entirely so model output cannot trigger an automatic browser request.
const readImage: InlineReader = (source, index) => {
  if (source[index] !== "!" || source[index + 1] !== "[") return undefined;
  const link = readLink(source, index + 1);
  return link === undefined ? undefined : { text: link.label, end: link.end };
};

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

function readLink(
  source: string,
  start: number,
): { label: string; target: string; end: number } | undefined {
  const closeLabel = source.indexOf("]", start + 1);
  if (closeLabel === -1 || source[closeLabel + 1] !== "(") return undefined;

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
