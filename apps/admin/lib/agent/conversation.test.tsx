import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ConversationProvider,
  isProseTurn,
  promptTurns,
  useConversation,
  type AgentTurnRecord,
} from "./conversation";

/**
 * One conversation per form subtree, held in memory (exit criterion 9). The subject is what
 * decides continuity, so the claims here are about moving between pathnames.
 */

let sent: AgentTurnRecord[] = [];

function Probe({ append }: { readonly append?: readonly AgentTurnRecord[] }) {
  const conversation = useConversation();
  sent = [...conversation.turns];
  return (
    <div>
      <span data-testid="subject">{conversation.subject}</span>
      <span data-testid="id">{conversation.id}</span>
      <span data-testid="turns">
        {conversation.turns
          .map((turn) => (isProseTurn(turn) ? turn.content : turn.proposalId))
          .join("|")}
      </span>
      <button
        type="button"
        data-testid="append"
        onClick={() => {
          conversation.append(append ?? []);
        }}
      >
        append
      </button>
      <button
        type="button"
        data-testid="append-twice"
        onClick={() => {
          // One handle, two appends: a panel records the user's turn and then the reply it
          // streamed, both from the handle its send started with.
          conversation.append([{ role: "user", content: "ask" }]);
          conversation.append([{ role: "assistant", content: "answer" }]);
        }}
      >
        append twice
      </button>
      <button
        type="button"
        data-testid="restart"
        onClick={() => {
          conversation.restart();
        }}
      >
        restart
      </button>
    </div>
  );
}

function at(pathname: string, append?: readonly AgentTurnRecord[]) {
  return (
    <ConversationProvider pathname={pathname}>
      <Probe {...(append === undefined ? {} : { append })} />
    </ConversationProvider>
  );
}

const read = () => ({
  id: screen.getByTestId("id").textContent,
  subject: screen.getByTestId("subject").textContent,
  turns: screen.getByTestId("turns").textContent,
});

describe("the conversation context", () => {
  it("keeps one conversation across a form's subtree and starts a new one outside it", () => {
    const view = render(at("/forms/frm_a", [{ role: "user", content: "add a step" }]));
    fireEvent.click(screen.getByTestId("append"));
    const builder = read();
    expect(builder.subject).toBe("form:frm_a");
    expect(builder.turns).toBe("add a step");

    view.rerender(at("/forms/frm_a/releases"));
    const releases = read();
    expect(releases.id).toBe(builder.id);
    expect(releases.turns).toBe("add a step");

    view.rerender(at("/operations"));
    const outside = read();
    expect(outside.subject).toBe("screen:/operations");
    expect(outside.id).not.toBe(builder.id);
    expect(outside.turns).toBe("");

    // Returning within the tab restores the form's own conversation.
    view.rerender(at("/forms/frm_a/responses"));
    expect(read()).toMatchObject({ id: builder.id, turns: "add a step" });
  });

  it("mints a fresh id and empties the history on a new conversation", () => {
    const view = render(at("/forms/frm_b", [{ role: "user", content: "hello" }]));
    fireEvent.click(screen.getByTestId("append"));
    const first = read();
    expect(first.turns).toBe("hello");

    fireEvent.click(screen.getByTestId("restart"));
    const second = read();
    expect(second.id).not.toBe(first.id);
    expect(second.turns).toBe("");

    view.unmount();
  });

  it("keeps both turns when a panel appends twice from the handle it started with", () => {
    render(at("/forms/frm_d"));
    fireEvent.click(screen.getByTestId("append-twice"));
    expect(screen.getByTestId("turns").textContent).toBe("ask|answer");
  });

  it("replays the prose and never the panel's own outcome line", () => {
    expect(
      promptTurns([
        { role: "user", content: "add a step" },
        { role: "assistant", content: "done" },
        { role: "result", content: "accepted" },
      ]),
    ).toEqual([
      { role: "user", content: "add a step" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("writes nothing to tab storage", () => {
    render(at("/forms/frm_c", [{ role: "user", content: "hi" }]));
    fireEvent.click(screen.getByTestId("append"));
    expect(sent).toHaveLength(1);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
