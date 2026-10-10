// Local development server: serves /public and runs /api/inspect like Vercel does.
// Usage: npm run dev  ->  http://localhost:3000
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/inspect.js";

const ROOT = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/api/inspect") return handler(req, res);
  const file = normalize(join(ROOT, path === "/" ? "index.html" : decodeURIComponent(path)));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end("Forbidden"); }
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    res.setHeader("content-type", TYPES[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(PORT, () => console.log(`Redart running at http://localhost:${PORT}`));
