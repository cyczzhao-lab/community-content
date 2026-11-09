#!/usr/bin/env node
/**
 * CHRONO-HEX: TEMPO NEXUS — Sample Autonomous Agent Bot (`sample_bot.js`)
 *
 * Connects to the HTTP/JSON API, reads game state and legal moves, evaluates
 * board control, Energy Relays, and the central Tempo Nexus (0,0), and submits
 * optimal moves until the match concludes.
 *
 * Usage:
 *   node sample_bot.js --url http://localhost:8787 --match TEMPO-BOT-TEST --seats 2 --auto-all
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = {
    url: process.env.GAME_URL || "http://localhost:8787",
    match: process.env.MATCH_CODE || "TEMPO-4217",
    seat: null, // null = play only AGENT seats, or all seats if --auto-all
    autoAll: true,
    numPlayers: 2,
    create: true
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) cfg.url = args[++i];
    else if (args[i] === "--match" && args[i + 1]) cfg.match = args[++i];
    else if (args[i] === "--seat" && args[i + 1]) {
      cfg.seat = Number(args[++i]);
      cfg.autoAll = false;
    } else if (args[i] === "--players" && args[i + 1]) cfg.numPlayers = Number(args[++i]);
    else if (args[i] === "--no-create") cfg.create = false;
  }
  return cfg;
}

function requestJson(baseUrl, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, baseUrl);
    const lib = u.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(
      u,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`Invalid JSON from ${pathname}: ${raw.slice(0, 120)}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function hexDist(q1, r1, q2, r2) {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/**
 * Sample Bot Heuristic Evaluator:
 * Scores every legal move returned by GET /api/matches/:code
 */
function selectBestAgentMove(state) {
  const pid = state.activePlayer;
  const legal = state.legalMoves || [];
  if (legal.length <= 1) return { type: "END_TURN" };

  let bestMove = { type: "END_TURN" };
  let bestScore = -999;

  for (const m of legal) {
    if (m.type === "END_TURN") continue;
    let score = 0;

    if (m.type === "MARCH") {
      const fromCell = state.cells[m.from];
      const toCell = state.cells[m.to];
      const distCenter = hexDist(toCell.q, toCell.r, 0, 0);

      if (toCell.owner !== pid) {
        const effDef = toCell.units + (toCell.shielded ? 1 : 0);
        if (m.units > effDef) {
          score += 50;
          if (toCell.type === "NEXUS") score += 65;
          if (toCell.type === "CITADEL") score += 90;
          if (toCell.type === "RELAY") score += 45;
          if (toCell.owner !== null) score += 20;
          score += (3 - distCenter) * 5;
        } else {
          score -= 60;
        }
      } else {
        const fromDist = hexDist(fromCell.q, fromCell.r, 0, 0);
        if (distCenter < fromDist && toCell.units <= 5) {
          score += 20 + (fromDist - distCenter) * 5;
        } else {
          score -= 10;
        }
      }
    } else if (m.type === "DEPLOY") {
      const cell = state.cells[m.target];
      score += 26;
      if (cell.type === "NEXUS") score += 25;
      if (cell.type === "CITADEL" && cell.units <= 3) score += 18;
      if (cell.units >= 6) score -= 20;
    } else if (m.type === "FORTIFY") {
      const cell = state.cells[m.target];
      if (cell.type === "NEXUS") score += 48;
      else if (cell.type === "RELAY") score += 32;
      else score += 12;
    } else if (m.type === "PULSE") {
      const cell = state.cells[m.target];
      score += 40;
      if (cell.type === "NEXUS" || cell.type === "CITADEL") score += 30;
      if (cell.shielded) score += 18;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }

  return bestScore > 5 ? bestMove : { type: "END_TURN" };
}

async function run() {
  const cfg = parseArgs();
  console.log(`[SampleBot] Connecting to ${cfg.url} (Match: ${cfg.match})...`);

  if (cfg.create) {
    const seats = [];
    for (let i = 0; i < cfg.numPlayers; i++) {
      seats.push({
        role: i === 0 ? "AGENT" : "BOT:TACTICIAN",
        name: i === 0 ? "SampleBot-HTTP-Agent" : `AutoBot-${i}`
      });
    }
    await requestJson(cfg.url, "POST", "/api/matches", {
      code: cfg.match,
      numPlayers: cfg.numPlayers,
      seats
    });
  }

  let stepCount = 0;
  while (stepCount < 200) {
    stepCount++;
    const res = await requestJson(cfg.url, "GET", `/api/matches/${cfg.match}`);
    if (!res.ok) throw new Error(res.error || "Failed to fetch match state");
    const state = res.state;

    if (state.status !== "ACTIVE") {
      const winner = state.players[state.winner];
      console.log(`\n======================================================`);
      console.log(`[SampleBot] MATCH FINISHED after ${state.round} rounds!`);
      console.log(`[SampleBot] WINNER: Seat ${state.winner} (${winner.name}) — ${state.winReason}`);
      console.log(
        `[SampleBot] Final Standings: ` +
          state.players.map((p) => `${p.name}: ${p.vp} VP (${p.energy}⚡)`).join(" | ")
      );
      console.log(`======================================================\n`);
      return;
    }

    const active = state.players[state.activePlayer];
    if (cfg.seat !== null && state.activePlayer !== cfg.seat) {
      // Trigger built-in bot step for the non-agent seat so the game advances
      await requestJson(cfg.url, "POST", `/api/matches/${cfg.match}/bot-step`, {});
      continue;
    }

    const move = selectBestAgentMove(state);
    console.log(
      `[Round ${String(state.round).padStart(2, "0")} | P${state.activePlayer + 1} ${active.name} (${active.vp}VP, ${active.energy}⚡, ${active.ap}AP)] -> ${move.type} ${move.desc || ""}`
    );

    const moveRes = await requestJson(cfg.url, "POST", `/api/matches/${cfg.match}/move`, move);
    if (!moveRes.ok) {
      console.warn(`[SampleBot] Move rejected (${moveRes.error}), sending END_TURN`);
      await requestJson(cfg.url, "POST", `/api/matches/${cfg.match}/move`, { type: "END_TURN" });
    }
  }
}

run().catch((err) => {
  console.error("[SampleBot] Error:", err.message);
  process.exit(1);
});
