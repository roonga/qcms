import type { ReactNode } from "react";

import {
  parseSafeMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from "@/lib/forms/assist-markdown";

export function AssistMarkdown({
  text,
  trailing,
}: {
  readonly text: string;
  readonly trailing?: ReactNode;
}) {
  const blocks = parseSafeMarkdown(text);
  if (blocks.length === 0) return trailing === undefined ? null : <p>{trailing}</p>;
  return (
    <div className="qcms-assist-md">
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          trailing={index === blocks.length - 1 ? trailing : undefined}
        />
      ))}
    </div>
  );
}

function Block({
  block,
  trailing,
}: {
  readonly block: MarkdownBlock;
  readonly trailing: ReactNode;
}) {
  if (block.kind === "code") {
    return (
      <pre className="qcms-assist-md__pre">
        <code>{block.text}</code>
        {trailing}
      </pre>
    );
  }
  if (block.kind === "list") {
    const items = block.items.map((item, index) => (
      <li key={index}>
        <Inlines nodes={item} />
        {index === block.items.length - 1 ? trailing : null}
      </li>
    ));
    return block.ordered ? (
      <ol start={block.start === 1 ? undefined : block.start}>{items}</ol>
    ) : (
      <ul>{items}</ul>
    );
  }
  return (
    <p>
      {block.lines.map((line, index) => (
        <span key={index}>
          {index > 0 && <br />}
          <Inlines nodes={line} />
        </span>
      ))}
      {trailing}
    </p>
  );
}

function Inlines({ nodes }: { readonly nodes: readonly MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "text":
            return <span key={index}>{node.text}</span>;
          case "code":
            return <code key={index}>{node.text}</code>;
          case "strong":
            return (
              <strong key={index}>
                <Inlines nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <Inlines nodes={node.children} />
              </em>
            );
          case "link":
            return (
              <a key={index} href={node.href}>
                <Inlines nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}
