/** Layouts do not guard route handlers or server actions. Scan each exported body and require it to honor its own guard response, with 303 for POST refusals; neighboring code and comments cannot satisfy the check. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHELL_DIR = `${ADMIN_ROOT}app/(shell)`;

const ROUTE_GUARD = "requireAdminSessionForRequest(";

const ACTION_GUARD = "requireAdminSession(";

const SAME_ORIGIN_CHECK = "isSameOriginPost(";

const MUTATING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SEGMENT_CONFIG = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);

const SCANNABLE_EXPORT = /^export async function (\w+)\s*\(/;

const EXPORTED_BINDING = /^export (?:const|let|var) (\w+)\b/;

interface HandlerFile {
  readonly path: string;
  readonly source: string;
  readonly kind: "route" | "action";
}

const USE_SERVER = new Set(['"use server";', "'use server';", '"use server"', "'use server'"]);

function declaresUseServer(source: string): boolean {
  return source.split("\n").some((line) => USE_SERVER.has(line.trim()));
}

function handlerFiles(dir: string, prefix = ""): HandlerFile[] {
  const out: HandlerFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (entry.isDirectory()) {
      out.push(...handlerFiles(`${dir}/${name}`, `${prefix}${name}/`));
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    const source = readFileSync(`${dir}/${name}`, "utf8");
    const isRoute = /^route\.tsx?$/.test(name);
    if (isRoute) out.push({ path: `${prefix}${name}`, source, kind: "route" });
    else if (declaresUseServer(source))
      out.push({ path: `${prefix}${name}`, source, kind: "action" });
  }
  return out;
}

const BODY_END = /^\}/;

const TOP_LEVEL_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\b/;

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

const TRAILING_COMMENT = /(^|\s)\/\/.*$/;

interface ExportedFunction {
  readonly name: string;

  readonly body: string;
}

function exportedFunctions(source: string): ExportedFunction[] {
  const lines = source.split("\n");
  const starts: { name: string; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = SCANNABLE_EXPORT.exec(line);
    if (match !== null) starts.push({ name: match[1] ?? "", line: index });
  }
  return starts.map((start, position) => ({
    name: start.name,
    body: handlerBody(lines, start.line, starts[position + 1]?.line ?? lines.length),
  }));
}

function handlerBody(lines: string[], start: number, limit: number): string {
  const end = lines.findIndex((line, index) => index > start && BODY_END.test(line));
  if (end === -1 || end > limit) return "";
  if (lines.slice(start + 1, end).some((line) => TOP_LEVEL_DECLARATION.test(line))) return "";
  return stripComments(lines.slice(start, end + 1)).join("\n");
}

function stripComments(lines: string[]): string[] {
  const code: string[] = [];
  let inBlockComment = false;
  for (const line of lines) {
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (COMMENT_LINE.test(line)) {
      inBlockComment = line.trimStart().startsWith("/*") && !line.includes("*/");
      continue;
    }
    code.push(line.replace(TRAILING_COMMENT, ""));
  }
  return code;
}

function uncheckedMutatingHandlers(source: string): string[] {
  return exportedFunctions(source)
    .filter((handler) => MUTATING_VERBS.has(handler.name))
    .filter((handler) => !handler.body.includes(SAME_ORIGIN_CHECK))
    .map((handler) => handler.name);
}

const RETURNS_REFUSAL = [`return ${ROUTE_GUARD}`, `return await ${ROUTE_GUARD}`];

const GUARD_BINDING = new RegExp(
  String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?` +
    ROUTE_GUARD.replace("(", String.raw`\s*\(`),
);

function usesRefusal(body: string): boolean {
  return narrowsGuardResult(body) || RETURNS_REFUSAL.some((spelling) => body.includes(spelling));
}

function narrowsGuardResult(body: string): boolean {
  return body
    .split("\n")
    .map((line) => GUARD_BINDING.exec(line)?.[1])
    .filter((name) => name !== undefined)
    .some((name) => new RegExp(String.raw`\b${name}\s+instanceof\s+Response\b`).test(body));
}

function unguardedHandlers(source: string, kind: HandlerFile["kind"]): string[] {
  const guard = kind === "route" ? ROUTE_GUARD : ACTION_GUARD;
  return exportedFunctions(source)
    .filter((handler) => !handler.body.includes(guard) || !honoursGuard(handler.body, kind))
    .map((handler) => handler.name);
}

function honoursGuard(body: string, kind: HandlerFile["kind"]): boolean {
  return kind !== "route" || usesRefusal(body);
}

function unscannableExports(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => line.startsWith("export "))
    .filter((line) => !SCANNABLE_EXPORT.test(line))
    .filter((line) => !line.startsWith("export type ") && !line.startsWith("export interface "))
    .filter((line) => {
      const binding = EXPORTED_BINDING.exec(line);
      return binding === null || !SEGMENT_CONFIG.has(binding[1] ?? "");
    })
    .map((line) => line.trim());
}

describe("issue #177: request handlers under app/(shell) carry their own session gate", () => {
  const files = handlerFiles(SHELL_DIR);

  it("finds the handlers it is supposed to be guarding", () => {
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["questions/actions.ts", "settings/password/route.ts"]),
    );
  });

  it.each(files)("$path exports only shapes this test can read (rule 4)", (file) => {
    expect(unscannableExports(file.source)).toEqual([]);
  });

  it.each(files)("$path guards every exported handler (rules 1 and 2)", (file) => {
    expect(exportedFunctions(file.source).length).toBeGreaterThan(0);
    expect(unguardedHandlers(file.source, file.kind)).toEqual([]);
  });

  it.each(files.filter((file) => file.kind === "route"))(
    "$path checks the request origin in each state-changing handler (rule 3, SEC-9)",
    (file) => {
      expect(uncheckedMutatingHandlers(file.source)).toEqual([]);
    },
  );

  it("keeps the two guard names non-overlapping", () => {
    expect(ROUTE_GUARD.includes(ACTION_GUARD)).toBe(false);
    expect(ACTION_GUARD.includes(ROUTE_GUARD)).toBe(false);
  });
});

const BELT_LINE = "  if (!isSameOriginPost(request)) return new Response(null, { status: 403 });";

const GUARD_LINES = [
  "  const session = await requireAdminSessionForRequest();",
  "  if (session instanceof Response) return session;",
];

const DISCARDED_GUARD_LINES = ["  void requireAdminSessionForRequest();"];

const FOREIGN_NARROWING_LINES = [
  "  void requireAdminSessionForRequest();",
  "  const upstream = await fetch(new URL(request.url));",
  "  if (upstream instanceof Response) return upstream;",
];

const COMMENTED_GUARD_LINES = [
  "  // requireAdminSessionForRequest() is not called here, and session instanceof Response",
  "  // is therefore never checked either.",
];

const RENAMED_GUARD_LINES = [
  "  const refusal = await requireAdminSessionForRequest();",
  "  if (refusal instanceof Response) return refusal;",
];

type GuardShape = "used" | "renamed" | "discarded" | "foreign" | "commented" | "absent";

const GUARD_BODY: Readonly<Record<GuardShape, readonly string[]>> = {
  used: GUARD_LINES,
  renamed: RENAMED_GUARD_LINES,
  discarded: DISCARDED_GUARD_LINES,
  foreign: FOREIGN_NARROWING_LINES,
  commented: COMMENTED_GUARD_LINES,
  absent: [],
};

const DOC_LINES = [
  "/**",
  " * Documented neighbour.",
  " *",
  " * Calls requireAdminSessionForRequest() and returns it if it is instanceof Response,",
  " * then checks isSameOriginPost(request) before changing anything.",
  " */",
];

interface HandlerShape {
  readonly belted?: boolean;

  readonly guard?: GuardShape;

  readonly documented?: boolean;
}

const handler = (verb: string, shape: HandlerShape = {}): string =>
  [
    ...(shape.documented === true ? DOC_LINES : []),
    `export async function ${verb}(request: Request): Promise<Response> {`,
    ...GUARD_BODY[shape.guard ?? "used"],
    ...(shape.belted === true ? [BELT_LINE] : []),
    "  return new Response(null, { status: 204 });",
    "}",
  ].join("\n");

const route = (...handlers: string[]): string =>
  [
    'import { isSameOriginPost } from "@/lib/server/origin";',
    'import { requireAdminSessionForRequest } from "@/lib/server/session";',
    "",
    ...handlers,
  ].join("\n\n");

describe("issue #177 rule 3: origin checks are per handler, and only for state changes", () => {
  it("asks nothing of a route that exports only GET", () => {
    expect(uncheckedMutatingHandlers(route(handler("GET")))).toEqual([]);
  });

  it("names a mutating handler that free-rides on its neighbour's origin check", () => {
    const source = route(handler("POST", { belted: true }), handler("DELETE"));
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("passes both handlers once each checks for itself", () => {
    const source = route(handler("POST", { belted: true }), handler("DELETE", { belted: true }));
    expect(uncheckedMutatingHandlers(source)).toEqual([]);
  });
});

describe("issue #177: a handler is judged on its own body, whatever follows it", () => {
  it("names an unguarded handler that sits above a documented neighbour (rule 1)", () => {
    const source = route(
      handler("DELETE", { guard: "absent", belted: true }),
      handler("POST", { documented: true, belted: true }),
    );
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
  });

  it("names an unbelted handler that sits above a documented neighbour (rule 3)", () => {
    const source = route(handler("DELETE"), handler("POST", { documented: true, belted: true }));
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("does not let a handler ride a private helper defined after it", () => {
    const helper = [
      "async function auditLog(request: Request): Promise<void> {",
      "  const session = await requireAdminSessionForRequest();",
      "  if (session instanceof Response) return;",
      "  if (!isSameOriginPost(request)) return;",
      "}",
    ].join("\n");
    const source = route(
      handler("DELETE", { guard: "absent" }),
      helper,
      handler("POST", { belted: true }),
    );
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("still passes a correctly guarded pair in either order", () => {
    const source = route(
      handler("DELETE", { belted: true }),
      handler("POST", { documented: true, belted: true }),
    );
    expect(unguardedHandlers(source, "route")).toEqual([]);
    expect(uncheckedMutatingHandlers(source)).toEqual([]);
  });
});

describe("issue #177 rule 1: a route handler must use the refusal its guard returns", () => {
  it.each([
    { shape: "discarded", failing: "calls the guard and discards its answer" },
    { shape: "foreign", failing: "discards the refusal and narrows a different value" },
    { shape: "commented", failing: "mentions the guard only in a comment" },
  ] as const)("names a handler that $failing", ({ shape }) => {
    const source = route(handler("DELETE", { guard: shape, belted: true }));
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
  });

  it("accepts the house call site whatever the binding is called", () => {
    const source = route(handler("DELETE", { guard: "renamed", belted: true }));
    expect(unguardedHandlers(source, "route")).toEqual([]);
  });

  it("accepts a guarded handler that also narrows an upstream response", () => {
    const source = route(
      [
        "export async function GET(request: Request): Promise<Response> {",
        ...GUARD_LINES,
        "  const upstream = await fetch(new URL(request.url));",
        "  if (upstream instanceof Response) return upstream;",
        "  return new Response(null, { status: 204 });",
        "}",
      ].join("\n"),
    );
    expect(unguardedHandlers(source, "route")).toEqual([]);
  });

  it("accepts a handler that returns the guard's result directly", () => {
    const source = [
      'import { requireAdminSessionForRequest } from "@/lib/server/session";',
      "",
      "export async function GET(): Promise<Response> {",
      "  return await requireAdminSessionForRequest();",
      "}",
    ].join("\n");
    expect(unguardedHandlers(source, "route")).toEqual([]);
  });

  it("asks nothing of the kind for a server action", () => {
    const source = [
      '"use server";',
      "",
      'import { requireAdminSession } from "@/lib/server/session";',
      "",
      "export async function saveAction(): Promise<void> {",
      "  await requireAdminSession();",
      "}",
    ].join("\n");
    expect(unguardedHandlers(source, "action")).toEqual([]);
  });
});

describe("issue #263: the last handler in a file is bounded like any other", () => {
  const indentedClose = (verb: string): string =>
    [
      "// prettier-ignore",
      `export async function ${verb}(request: Request): Promise<Response> {`,
      "  const body = await request.text();",
      "  return new Response(body, { status: 200 });",
      "  }",
    ].join("\n");

  const auditHelper = [
    "async function auditLog(request: Request): Promise<void> {",
    "  const session = await requireAdminSessionForRequest();",
    "  if (session instanceof Response) return;",
    "  if (!isSameOriginPost(request)) return;",
    "}",
  ].join("\n");

  it("names a last handler whose body would otherwise swallow a private helper", () => {
    const source = route(indentedClose("DELETE"), auditHelper);
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("names it when the trailing code is a class rather than a function", () => {
    const auditClass = [
      "class AuditLog {",
      "  async run(request: Request): Promise<void> {",
      "    const session = await requireAdminSessionForRequest();",
      "    if (session instanceof Response) return;",
      "    if (!isSameOriginPost(request)) return;",
      "  }",
      "}",
    ].join("\n");
    const source = route(indentedClose("DELETE"), auditClass);
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("still passes a well-formed last handler followed by private helpers", () => {
    const source = route(handler("DELETE", { belted: true }), auditHelper);
    expect(unguardedHandlers(source, "route")).toEqual([]);
    expect(uncheckedMutatingHandlers(source)).toEqual([]);
  });

  it("still passes the last of several well-formed handlers", () => {
    const source = route(
      handler("POST", { documented: true, belted: true }),
      handler("DELETE", { belted: true }),
    );
    expect(unguardedHandlers(source, "route")).toEqual([]);
    expect(uncheckedMutatingHandlers(source)).toEqual([]);
  });
});
