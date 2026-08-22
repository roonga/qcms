// Serve design previews read-only over HTTP so they can be viewed from the host
// browser on this machine seat's artifacts port
// (7S30, so http://localhost:7030 at the default seat 0; published by the
// devcontainer's appPort). The allocation rule and table: docs/PORTS.md. Roots:
//   /plan/       -> plan/                             (design previews, specs)
// Start with `pnpm artifacts`. Seat: QCMS_PORT_SEAT. Port override (wins over the
// seat, for an unusual machine): QCMS_ARTIFACTS_PORT.

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { stablePort } from "./ports.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const port = Number(process.env.QCMS_ARTIFACTS_PORT ?? stablePort("artifacts"));

const roots = { plan: join(repoRoot, "plan") };

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const escapeHtml = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
  `<body style="font-family: system-ui, sans-serif; margin: 2rem;"><h1>${escapeHtml(title)}</h1>${body}`;

// Resolve a URL path under a root directory, refusing anything that escapes it.
const safeJoin = (rootDir, urlPath) => {
  const target = resolve(rootDir, "." + urlPath);
  if (target !== rootDir && !target.startsWith(rootDir + sep)) return null;
  return target;
};

const listDir = async (dir, urlBase) => {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const items = entries
    .filter((e) => !e.name.startsWith("."))
    .map((e) => {
      const suffix = e.isDirectory() ? "/" : "";
      const name = escapeHtml(e.name);
      return `<li><a href="${urlBase}${encodeURIComponent(e.name)}${suffix}">${name}${suffix}</a></li>`;
    });
  return `<ul>${items.join("")}</ul>`;
};

const serveIndex = async (res) => {
  const body = `<ul><li><a href="/plan/">plan/</a> - design previews and planning files</li></ul>`;
  res.writeHead(200, { "content-type": contentTypes[".html"] });
  res.end(page("QCMS artifacts", body));
};

// Map a request path to { fsPath, urlBase } or null when it matches no root.
const resolveTarget = (path) => {
  const [, top, ...rest] = path.split("/");
  if (top in roots) {
    const fsPath = safeJoin(roots[top], "/" + rest.join("/"));
    return fsPath ? { fsPath, urlBase: `/${top}/` } : null;
  }
  return null;
};

const handler = async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path === "/") return serveIndex(res);

  const target = resolveTarget(path);
  if (!target) {
    res.writeHead(404, { "content-type": contentTypes[".txt"] });
    return res.end("not found");
  }

  try {
    if (path.endsWith("/")) {
      const body = await listDir(target.fsPath, path);
      res.writeHead(200, { "content-type": contentTypes[".html"] });
      return res.end(page(path, `<p><a href="/">index</a></p>${body}`));
    }
    const bytes = await readFile(target.fsPath);
    res.writeHead(200, {
      "content-type": contentTypes[extname(target.fsPath)] ?? "application/octet-stream",
    });
    return res.end(bytes);
  } catch {
    res.writeHead(404, { "content-type": contentTypes[".txt"] });
    return res.end("not found");
  }
};

createServer((req, res) => {
  handler(req, res).catch(() => {
    res.writeHead(500, { "content-type": contentTypes[".txt"] });
    res.end("error");
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`QCMS artifacts server: http://localhost:${port}/ (read-only)`);
});
