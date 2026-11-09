#!/usr/bin/env node
/**
 * CHRONO-HEX: TEMPO NEXUS — Zero-Dependency HTTP/JSON Multiplayer & Agent API Server
 * Serves both the interactive HTML5 browser client and the documented Agent REST API.
 *
 * Usage:
 *   PORT=8787 node server.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const Engine = require("./engine.js");

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_DIR = __dirname;

// In-memory match store keyed by Match Code
const matches = new Map();

function ensureMatch(code = "TEMPO-4217", options = {}) {
  const cleanCode = String(code || "TEMPO-4217").toUpperCase();
  if (!matches.has(cleanCode)) {
    matches.set(cleanCode, Engine.createMatch({ code: cleanCode, ...options }));
  }
  return matches.get(cleanCode);
}

// Seed default lobby match
ensureMatch("TEMPO-4217", {
  numPlayers: 2,
  seats: [
    { role: "HUMAN", name: "Solaris Commander" },
    { role: "BOT:TACTICIAN", name: "Aether [Tactician Bot]" }
  ]
});

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function summarizeState(state) {
  return {
    code: state.code,
    status: state.status,
    numPlayers: state.numPlayers,
    round: state.round,
    maxRounds: state.maxRounds,
    targetVp: state.targetVp,
    turnIndex: state.turnIndex,
    activePlayer: state.activePlayer,
    winner: state.winner,
    winReason: state.winReason,
    players: state.players,
    cells: state.cells,
    legalMoves: Engine.getLegalMoves(state, state.activePlayer),
    log: state.log.slice(-30),
    snapshotCount: (state.snapshots || []).length
  };
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. Health & API Discovery
    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        game: "CHRONO-HEX: TEMPO NEXUS",
        version: "1.0.0",
        activeMatches: Array.from(matches.keys()),
        endpoints: [
          "GET  /api/matches",
          "POST /api/matches",
          "GET  /api/matches/:code",
          "GET  /api/matches/:code/moves",
          "POST /api/matches/:code/move",
          "POST /api/matches/:code/bot-step",
          "GET  /api/matches/:code/replay"
        ]
      });
    }

    // 2. List or Create Matches
    if (pathname === "/api/matches" && req.method === "GET") {
      const list = Array.from(matches.values()).map((m) => ({
        code: m.code,
        status: m.status,
        round: m.round,
        maxRounds: m.maxRounds,
        numPlayers: m.numPlayers,
        activePlayer: m.activePlayer,
        winner: m.winner,
        players: m.players.map((p) => ({ id: p.id, name: p.name, role: p.role, vp: p.vp, energy: p.energy }))
      }));
      return sendJson(res, 200, { ok: true, matches: list });
    }

    if (pathname === "/api/matches" && req.method === "POST") {
      const body = await readJsonBody(req);
      const code = String(body.code || `NEXUS-${Math.floor(1000 + Math.random() * 9000)}`).toUpperCase();
      const state = Engine.createMatch({
        code,
        numPlayers: body.numPlayers || 2,
        maxRounds: body.maxRounds || 12,
        targetVp: body.targetVp || 25,
        seats: body.seats || []
      });
      matches.set(code, state);
      return sendJson(res, 201, { ok: true, state: summarizeState(state) });
    }

    // 3. Match-specific routes: /api/matches/:code[/action]
    const matchRoute = pathname.match(/^\/api\/matches\/([A-Za-z0-9_-]+)(?:\/([a-z-]+))?$/);
    if (matchRoute) {
      const code = matchRoute[1].toUpperCase();
      const subAction = matchRoute[2] || "";
      const state = ensureMatch(code);

      if (!subAction && req.method === "GET") {
        return sendJson(res, 200, { ok: true, state: summarizeState(state) });
      }

      if (subAction === "moves" && req.method === "GET") {
        const legalMoves = Engine.getLegalMoves(state, state.activePlayer);
        return sendJson(res, 200, {
          ok: true,
          code: state.code,
          round: state.round,
          activePlayer: state.activePlayer,
          ap: state.players[state.activePlayer]?.ap || 0,
          energy: state.players[state.activePlayer]?.energy || 0,
          legalMoves
        });
      }

      if (subAction === "move" && req.method === "POST") {
        const body = await readJsonBody(req);
        const move = body.move || body;
        const result = Engine.applyMove(state, move);
        if (!result.ok) {
          return sendJson(res, 400, { ok: false, error: result.error, state: summarizeState(state) });
        }
        return sendJson(res, 200, { ok: true, appliedMove: move, state: summarizeState(state) });
      }

      if (subAction === "bot-step" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (state.status !== "ACTIVE") {
          return sendJson(res, 200, { ok: true, message: "Match already finished", state: summarizeState(state) });
        }
        const chosen = Engine.chooseBotMove(state, body.personality);
        const result = Engine.applyMove(state, chosen);
        return sendJson(res, 200, {
          ok: result.ok,
          botMove: chosen,
          state: summarizeState(state)
        });
      }

      if (subAction === "replay" && req.method === "GET") {
        return sendJson(res, 200, {
          ok: true,
          code: state.code,
          status: state.status,
          winner: state.winner,
          winReason: state.winReason,
          log: state.log,
          snapshots: state.snapshots || []
        });
      }
    }

    // 4. Static file serving
    let relPath = pathname === "/" ? "/index.html" : pathname;
    const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
    const fullPath = path.join(PUBLIC_DIR, safePath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*"
      });
      return fs.createReadStream(fullPath).pipe(res);
    }

    sendJson(res, 404, { ok: false, error: `Not found: ${pathname}` });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[CHRONO-HEX] Server listening on http://localhost:${PORT}`);
    console.log(`[CHRONO-HEX] Human UI:  http://localhost:${PORT}/`);
    console.log(`[CHRONO-HEX] Agent API: http://localhost:${PORT}/api/matches/TEMPO-4217`);
  });
}

module.exports = { server, matches, ensureMatch };
