import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CONVERSATION_STORAGE_KEY } from "./conversation-state";
import {
  CONVERSATION_TURN_CAP,
  ConversationProvider,
  clearStoredConversation,
  isProseTurn,
  useConversation,
  type AgentTurnRecord,
} from "./conversation";

function Probe({ append }: { readonly append?: readonly AgentTurnRecord[] }) {
  const conversation = useConversation();
  return (
    <div>
      <span data-testid="subject">{conversation.subject}</span>
      <span data-testid="id">{conversation.id}</span>
      <span data-testid="visit">{conversation.visitId}</span>
      <span data-testid="dropped">{conversation.dropped}</span>
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
          conversation.append([{ role: "user", content: "ask" }]);
          conversation.append([{ role: "assistant", content: "answer" }]);
        }}
      >
        append twice
      </button>
      <button
        type="button"
        data-testid="fill"
        onClick={() => {
          for (let turn = 0; turn <= CONVERSATION_TURN_CAP; turn += 1) {
            conversation.append([{ role: "user", content: `turn ${String(turn)}` }]);
          }
        }}
      >
        fill
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

function at(pathname: string, append?: readonly AgentTurnRecord[], userId = "usr_1") {
  return (
    <ConversationProvider pathname={pathname} userId={userId}>
      <Probe {...(append === undefined ? {} : { append })} />
    </ConversationProvider>
  );
}

const read = () => ({
  id: screen.getByTestId("id").textContent,
  visitId: screen.getByTestId("visit").textContent,
  subject: screen.getByTestId("subject").textContent,
  dropped: screen.getByTestId("dropped").textContent,
  turns: screen.getByTestId("turns").textContent,
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("one conversation across the app", () => {
  it("keeps the dialogue and the id through every screen the operator walks", () => {
    const view = render(at("/questions", [{ role: "user", content: "add a step" }]));
    fireEvent.click(screen.getByTestId("append"));
    const first = read();
    expect(first.subject).toBe("screen:/questions");
    expect(first.turns).toBe("add a step");

    view.rerender(at("/forms"));
    expect(read()).toMatchObject({ id: first.id, turns: "add a step" });

    view.rerender(at("/forms/frm_a"));
    expect(read()).toMatchObject({ id: first.id, turns: "add a step" });

    view.rerender(at("/workspaces"));
    expect(read()).toMatchObject({ id: first.id, turns: "add a step" });
  });

  it("names the subject the next turn will use", () => {
    const view = render(at("/forms"));
    expect(read().subject).toBe("screen:/forms");
    view.rerender(at("/forms/frm_a/publish"));
    expect(read().subject).toBe("form:frm_a");
  });

  it("mints a new stay on each subject and again on return", () => {
    const view = render(at("/forms"));
    const start = read();

    view.rerender(at("/forms/frm_a"));
    const away = read();
    expect(away.visitId).not.toBe(start.visitId);

    view.rerender(at("/forms/frm_a/rules"));
    expect(read().visitId).toBe(away.visitId);

    view.rerender(at("/forms"));
    const back = read();
    expect(back.visitId).not.toBe(away.visitId);
    expect(back.visitId).not.toBe(start.visitId);
  });

  it("mints a fresh id and empties the history on a new conversation", () => {
    render(at("/forms/frm_b", [{ role: "user", content: "hello" }]));
    fireEvent.click(screen.getByTestId("append"));
    const first = read();
    expect(first.turns).toBe("hello");

    fireEvent.click(screen.getByTestId("restart"));
    const second = read();
    expect(second.id).not.toBe(first.id);
    expect(second.turns).toBe("");
    expect(second.dropped).toBe("0");
  });

  it("keeps both turns when a panel appends twice from the handle it started with", () => {
    render(at("/forms/frm_d"));
    fireEvent.click(screen.getByTestId("append-twice"));
    expect(screen.getByTestId("turns").textContent).toBe("ask|answer");
  });

  it("drops the oldest turns past the cap and says how many", () => {
    render(at("/forms"));
    fireEvent.click(screen.getByTestId("fill"));
    const filled = read();
    expect(filled.dropped).toBe("1");
    expect(filled.turns?.startsWith("turn 1|")).toBe(true);
  });
});

describe("the conversation between page loads", () => {
  it("comes back after a reload of the same tab", () => {
    const first = render(at("/forms", [{ role: "user", content: "still here" }]));
    fireEvent.click(screen.getByTestId("append"));
    const before = read();
    first.unmount();

    render(at("/forms"));
    expect(read()).toMatchObject({ id: before.id, turns: "still here" });
  });

  it("is not handed to another user signing in to the same tab", () => {
    const first = render(at("/forms", [{ role: "user", content: "mine" }]));
    fireEvent.click(screen.getByTestId("append"));
    const before = read();
    first.unmount();

    render(at("/forms", undefined, "usr_2"));
    const other = read();
    expect(other.turns).toBe("");
    expect(other.id).not.toBe(before.id);
  });

  it("is gone once sign-out has cleared it", () => {
    const first = render(at("/forms", [{ role: "user", content: "ending" }]));
    fireEvent.click(screen.getByTestId("append"));
    first.unmount();

    clearStoredConversation();
    expect(window.sessionStorage.getItem(CONVERSATION_STORAGE_KEY)).toBeNull();

    render(at("/forms"));
    expect(read().turns).toBe("");
  });

  it("writes nothing to localStorage", () => {
    render(at("/forms", [{ role: "user", content: "hi" }]));
    fireEvent.click(screen.getByTestId("append"));
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.getItem(CONVERSATION_STORAGE_KEY)).not.toBeNull();
  });
});
