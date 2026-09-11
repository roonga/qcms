import { describe, expect, it } from "vitest";

import { cellExpressions, maskLiteralsAndComments, tableCells } from "./jsx-cells.ts";

/**
 * The scanner behind `app/(shell)/table-cell-rules.test.ts`, tested on its own.
 *
 * A gate built on a scanner is only as trustworthy as the scanner, and a scan that quietly
 * stops finding things passes every assertion downstream of it. So the cases here are the
 * ones that decide whether that gate means anything: a comment cannot become a finding, a
 * string cannot become a finding, an attribute is not a rendered child, and a value rendered
 * inside a conditional subtree still is one.
 *
 * `components/test-support/markup.test.ts` exists for the same reason, one layer down.
 */

function childrenOf(source: string): readonly string[] {
  const masked = maskLiteralsAndComments(source);
  return tableCells(masked)
    .flatMap((cell) => cellExpressions(source, masked, cell))
    .filter((one) => one.isChild && one.masked.trim() !== "")
    .map((one) => one.masked.trim());
}

function attributesOf(source: string): readonly string[] {
  const masked = maskLiteralsAndComments(source);
  return tableCells(masked)
    .flatMap((cell) => cellExpressions(source, masked, cell))
    .filter((one) => !one.isChild && one.masked.trim() !== "")
    .map((one) => one.masked.trim());
}

describe("masking", () => {
  it("blanks a string's contents and keeps every offset", () => {
    const source = 'const a = "row.sessionId";';
    const masked = maskLiteralsAndComments(source);
    expect(masked).toHaveLength(source.length);
    expect(masked).not.toContain("sessionId");
    expect(masked.startsWith("const a = ")).toBe(true);
  });

  it("blanks both comment shapes, so a comment cannot be read as code", () => {
    expect(maskLiteralsAndComments("// row.sessionId\nkeep")).toContain("keep");
    expect(maskLiteralsAndComments("// row.sessionId\nkeep")).not.toContain("sessionId");
    expect(maskLiteralsAndComments("/* row.createdAt */ keep")).not.toContain("createdAt");
  });

  it("does not mistake a URL inside a string for a comment", () => {
    // The failure this guards: a naive `//` strip eats the rest of the line, and the line
    // after it, taking real code with it.
    const source = 'const url = "https://example.test/x";\nrender(row.sessionId);';
    const masked = maskLiteralsAndComments(source);
    expect(masked).toContain("render(row.sessionId);");
  });

  it("leaves a template literal's holes readable and blanks its text", () => {
    const source = "const href = `/forms/${row.formId}/x`;";
    const masked = maskLiteralsAndComments(source);
    expect(masked).toContain("${row.formId}");
    expect(masked).not.toContain("/forms/");
  });
});

describe("finding cells", () => {
  it("reads both cell tags", () => {
    const cells = tableCells(maskLiteralsAndComments("<tr><th>a</th><td>b</td></tr>"));
    expect(cells.map((cell) => cell.tag)).toEqual(["th", "td"]);
  });

  it("survives a `>` inside an attribute expression on the cell itself", () => {
    const source = '<td className={count > 0 ? "a" : "b"}>{row.sessionId}</td>';
    expect(childrenOf(source)).toEqual(["row.sessionId"]);
  });

  it("finds nothing in a file with no cells, which is how the gate skips a non-table", () => {
    expect(tableCells(maskLiteralsAndComments("<p>{row.sessionId}</p>"))).toEqual([]);
  });
});

describe("classifying what a cell holds", () => {
  it("separates an attribute value from a rendered child", () => {
    const source = "<td><code data-x={row.formId}>{row.sessionId}</code></td>";
    expect(attributesOf(source)).toEqual(["row.formId"]);
    expect(childrenOf(source)).toEqual(["row.sessionId"]);
  });

  it("reads a cell's children and not its own attributes", () => {
    // The scanned range starts after the cell's opening tag, so `data-session-id={…}` on a
    // `<td>` or a `<tr>` is outside it by construction rather than by classification. That
    // is the right shape for the gate - those attributes are never rendered text - and it
    // is stated here so the emptiness is not read as the classifier working.
    const source = "<td data-x={row.formId}>{row.label}</td>";
    expect(attributesOf(source)).toEqual([]);
    expect(childrenOf(source)).toEqual(["row.label"]);
  });

  it("treats a value inside a nested element as rendered", () => {
    expect(childrenOf("<td><code>{row.sessionId}</code></td>")).toEqual(["row.sessionId"]);
  });

  it("recurses into a conditional subtree rather than reporting it whole", () => {
    // The first draft reported this group entire, which made the handler inside it look
    // like rendered text and every conditional cell a false finding.
    const source = [
      "<td>",
      "  {isRevocable(link.state) && (",
      "    <Button onPress={() => { onRevoke(link.linkId); }}>{label}</Button>",
      "  )}",
      "</td>",
    ].join("\n");
    expect(childrenOf(source)).toEqual(["label"]);
    expect(attributesOf(source)).toEqual(["() => { onRevoke(link.linkId); }"]);
  });

  it("keeps a JSX comment out of the results", () => {
    expect(childrenOf("<td>{/* row.sessionId */}{row.label}</td>")).toEqual(["row.label"]);
  });

  it("reports the original text while matching the masked copy", () => {
    const source = '<td>{t("ops.responses.column.sessionId")}</td>';
    const masked = maskLiteralsAndComments(source);
    const [cell] = tableCells(masked);
    expect(cell).toBeDefined();
    const [only] = cellExpressions(source, masked, cell as never);
    expect(only?.text).toBe('t("ops.responses.column.sessionId")');
    expect(only?.masked).not.toContain("sessionId");
  });
});
