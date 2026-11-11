// Local server for the radar: serves static files and proxies OpenSky
// (OpenSky does not send CORS headers for other origins, so the browser
// cannot call it directly).
//
//   node server.js                 → http://localhost:8080 (this computer only)
//   PORT=3000 node server.js       → custom port
//   HOST=0.0.0.0 node server.js    → reachable from the local network (shares the
//                                    OpenSky daily quota with everyone who can reach it)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const CACHE_MS = 10_000; // OpenSky anonymous data updates every 10 s anyway

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let cache = { key: null, at: 0, body: null };

async function proxyOpenSky(url, res) {
  const parts = [];
  for (const k of ["lamin", "lomin", "lamax", "lomax"]) {
    const v = Number(url.searchParams.get(k));
    if (!Number.isFinite(v) || Math.abs(v) > 180) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid bounding box" }));
    }
    parts.push(`${k}=${v}`);
  }
  const key = parts.join("&");

  if (cache.key === key && Date.now() - cache.at < CACHE_MS) {
    res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "HIT" });
    return res.end(cache.body);
  }

  try {
    const r = await fetch(`https://opensky-network.org/api/states/all?${key}`, {
      headers: { "User-Agent": "radar-atc-sim/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await r.text();
    if (r.ok) cache = { key, at: Date.now(), body };
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}

function serveStatic(url, res) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(ROOT, rel));
  // no path traversal, no dotfiles
  if (!file.startsWith(ROOT + path.sep) || rel.split("/").some((s) => s.startsWith("."))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/opensky") return proxyOpenSky(url, res);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    serveStatic(url, res);
  })
  .listen(PORT, HOST, () => console.log(`Radar: http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`));
