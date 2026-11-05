import { describe, expect, it } from "vitest";

import { queueFormName, queueFormNames } from "./queue-forms.ts";

describe("a global queue's form names", () => {
  it("are the forms this caller may read", () => {
    const names = queueFormNames({
      ok: true,
      data: [
        { formId: "frm_a", slug: "alpha" },
        { formId: "frm_b", slug: "beta" },
      ],
    });
    expect(queueFormName(names, "frm_a")).toBe("alpha");
    expect(queueFormName(names, "frm_b")).toBe("beta");
  });

  it("leave a form the caller may not read unnamed", () => {
    const names = queueFormNames({ ok: true, data: [{ formId: "frm_a", slug: "alpha" }] });
    expect(queueFormName(names, "frm_other")).toBeUndefined();
    expect(queueFormName(names, "toString")).toBeUndefined();
  });

  it("are empty when the read is refused or fails", () => {
    expect(queueFormNames({ ok: false })).toEqual({});
  });
});
