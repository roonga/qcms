import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { initialsFor } from "@/lib/initials";

import { AccountMenu } from "./account-menu.tsx";

interface Shape {
  readonly what: string;
  readonly email: string;
  readonly name?: string;
  readonly initials: string;
  readonly codePoints?: readonly number[];
}

const DECOMPOSED_NAME = "o\u0301lafur a\u0301sta";

const SHAPES: readonly Shape[] = [
  {
    what: "a two-part display name whose initials appear nowhere in the address",
    email: "dev@qcms.test",
    name: "Zoe Wren",
    initials: "ZW",
  },
  {
    what: "the Administrator bootstrap default",
    email: "dev@qcms.test",
    name: "Administrator",
    initials: "AD",
  },
  {
    what: "no display name, so the initials come from the address",
    email: "dev@qcms.test",
    initials: "DE",
  },
  {
    what: "a display name whose initials are non-ASCII",
    email: "dev@qcms.test",
    name: DECOMPOSED_NAME,
    initials: "O\u0301A\u0301",
    codePoints: [0x004f, 0x0301, 0x0041, 0x0301],
  },
  {
    what: "a one-character monogram",
    email: "x@qcms.test",
    name: "X",
    initials: "X",
  },
];

function paintedText(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

function contains(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("the account trigger satisfies label-in-name (WCAG 2.5.3)", () => {
  for (const shape of SHAPES) {
    it(`names the trigger with the initials it paints: ${shape.what}`, () => {
      const container = render(
        <AccountMenu email={shape.email} {...(shape.name !== undefined && { name: shape.name })} />,
      ).container;
      const scope = within(container);
      const trigger = scope.getByRole("button");

      const visible = paintedText(trigger);
      expect(visible).toBe(shape.initials);
      expect(initialsFor(shape.email, shape.name)).toBe(shape.initials);

      if (shape.codePoints !== undefined) {
        expect(
          [...visible].map((character) => character.codePointAt(0)),
          "the monogram lost its decomposed form somewhere between the source literal and the DOM",
        ).toEqual([...shape.codePoints]);
      }

      expect(scope.getAllByRole("button", { name: startsWith(visible) })).toContain(trigger);

      expect(scope.getAllByRole("button", { name: contains(shape.email) })).toContain(trigger);
    });
  }

  it("sweeps a shape whose initials the address cannot supply", () => {
    const falsifiable = SHAPES.filter(
      (shape) => !shape.email.toLowerCase().includes(shape.initials.toLowerCase()),
    );
    expect(falsifiable.map((shape) => shape.initials)).toContain("ZW");
  });
});
