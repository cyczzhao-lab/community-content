/**
 * CHRONO-HEX: TEMPO NEXUS — Deterministic Hex-Grid Multiplayer Strategy Engine
 * Playable by Humans (Browser UI) and AI Agents (HTTP/JSON REST API + window.AGENT_API)
 * Zero dependencies. Runs identically in Node.js and modern browsers.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ChronoHexEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FACTIONS = [
    { id: 0, name: "Solaris", color: "#FF5500", light: "#FF9966", bg: "#2B1206", badge: "SOL" },
    { id: 1, name: "Aether",  color: "#00D2FF", light: "#80E8FF", bg: "#05202B", badge: "AET" },
    { id: 2, name: "Verdant", color: "#10B981", light: "#6EE7B7", bg: "#05261B", badge: "VRD" },
    { id: 3, name: "Obsidian",color: "#C084FC", light: "#E9D5FF", bg: "#210B33", badge: "OBS" }
  ];

  const HEX_DIRS = [
    [1, 0], [1, -1], [0, -1],
    [-1, 0], [-1, 1], [0, 1]
  ];

  // Deterministic PRNG (Mulberry32)
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || "TEMPO-4217");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seedStr) {
    let a = hashSeed(seedStr);
    return function () {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hexKey(q, r) {
    return `${q},${r}`;
  }

  function hexDist(q1, r1, q2, r2) {
    const dq = q1 - q2;
    const dr = r1 - r2;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  }

  function getNeighbors(q, r, cells) {
    const out = [];
    for (let i = 0; i < HEX_DIRS.length; i++) {
      const nq = q + HEX_DIRS[i][0];
      const nr = r + HEX_DIRS[i][1];
      const key = hexKey(nq, nr);
      if (cells[key]) out.push(cells[key]);
    }
    return out;
  }

  // Starting home-citadel coordinates for 2, 3, or 4 players on radius-3 hex grid
  const START_CITADELS = [
    [0, -3],  // Seat 0: North-East edge
    [0, 3],   // Seat 1: South-West edge
    [-3, 0],  // Seat 2: West edge
    [3, 0]    // Seat 3: East edge
  ];

  const RELAY_COORDS = [
    [2, -1], [-2, 1],
    [-1, -1], [1, 1],
    [-1, 2], [1, -2]
  ];

  function createMatch(options = {}) {
    const code = String(options.code || "TEMPO-4217").toUpperCase();
    const numPlayers = Math.min(4, Math.max(2, Number(options.numPlayers || 2)));
    const maxRounds = Number(options.maxRounds || 12);
    const targetVp = Number(options.targetVp || 25);
    const rng = makeRng(code);

    const cells = {};
    const radius = 3;
    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) {
        const key = hexKey(q, r);
        let type = "STANDARD";
        let owner = null;
        let units = 0;
        let shielded = false;

        if (q === 0 && r === 0) {
          type = "NEXUS";
          units = 2; // Neutral guardians on the central Tempo Nexus
        } else if (RELAY_COORDS.some(([rq, rr]) => rq === q && rr === r)) {
          type = "RELAY";
          units = 1; // Light neutral sentry
        }

        cells[key] = {
          key,
          q,
          r,
          type, // NEXUS | CITADEL | RELAY | RIFT | STANDARD
          owner,
          units,
          shielded
        };
      }
    }

    // Place 3 symmetric or seeded Quantum Rifts on standard cells at distance 2
    const candidateRifts = Object.values(cells).filter(
      (c) =>
        c.type === "STANDARD" &&
        hexDist(c.q, c.r, 0, 0) === 2 &&
        !START_CITADELS.some(([sq, sr]) => hexDist(c.q, c.r, sq, sr) <= 1)
    );
    candidateRifts.sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(3, candidateRifts.length); i++) {
      candidateRifts[i].type = "RIFT";
    }

    // Configure players & starting Citadels
    const seatConfigs = options.seats || [];
    const players = [];
    for (let pid = 0; pid < numPlayers; pid++) {
      const f = FACTIONS[pid];
      const sc = seatConfigs[pid] || {};
      const role = sc.role || (pid === 0 ? "HUMAN" : "BOT:TACTICIAN");
      const name = sc.name || (role === "HUMAN" ? `${f.name} Commander` : `${f.name} [${role.replace("BOT:", "")}]`);

      const [cq, cr] = START_CITADELS[pid];
      const cKey = hexKey(cq, cr);
      cells[cKey].type = "CITADEL";
      cells[cKey].owner = pid;
      cells[cKey].units = 4;
      cells[cKey].shielded = false;

      // Also give each player 1 adjacent vanguard hex with 2 units so Turn 1 has immediate branching choices
      const adj = getNeighbors(cq, cr, cells).filter((n) => n.type === "STANDARD" && n.owner === null);
      adj.sort((a, b) => hexDist(a.q, a.r, 0, 0) - hexDist(b.q, b.r, 0, 0));
      if (adj[0]) {
        adj[0].owner = pid;
        adj[0].units = 2;
      }

      players.push({
        id: pid,
        faction: f.name,
        badge: f.badge,
        color: f.color,
        light: f.light,
        bg: f.bg,
        name,
        role, // "HUMAN" | "AGENT" | "BOT:AGGRESSOR" | "BOT:HARVESTER" | "BOT:TACTICIAN"
        energy: 4,
        vp: 2, // 1 Citadel (2 VP)
        ap: 2,
        alive: true,
        citadelKey: cKey
      });
    }

    const state = {
      code,
      version: "1.0.0",
      status: "ACTIVE", // ACTIVE | FINISHED
      numPlayers,
      round: 1,
      maxRounds,
      targetVp,
      turnIndex: 0,
      activePlayer: 0,
      winner: null,
      winReason: null,
      players,
      cells,
      log: [
        {
          seq: 1,
          round: 1,
          player: null,
          type: "MATCH_START",
          text: `Match ${code} initialized (${numPlayers} players, Target ${targetVp} VP or ${maxRounds} rounds).`
        }
      ],
      snapshots: []
    };

    saveSnapshot(state, "Round 1 Start");
    return state;
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify({
      code: state.code,
      version: state.version,
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
      log: state.log.slice(-40)
    }));
  }

  function saveSnapshot(state, label) {
    if (!state.snapshots) state.snapshots = [];
    state.snapshots.push({
      step: state.snapshots.length,
      label,
      round: state.round,
      activePlayer: state.activePlayer,
      state: cloneState(state)
    });
  }

  function appendLog(state, player, type, text, meta = {}) {
    state.log.push({
      seq: state.log.length + 1,
      round: state.round,
      player,
      type,
      text,
      ...meta
    });
  }

  function getPlayerTerritoryStats(state, pid) {
    let hexCount = 0;
    let totalUnits = 0;
    let relays = 0;
    let citadels = 0;
    let hasNexus = false;
    for (const c of Object.values(state.cells)) {
      if (c.owner === pid) {
        hexCount++;
        totalUnits += c.units;
        if (c.type === "RELAY") relays++;
        if (c.type === "CITADEL") citadels++;
        if (c.type === "NEXUS") hasNexus = true;
      }
    }
    return { hexCount, totalUnits, relays, citadels, hasNexus };
  }

  function getLegalMoves(state, pid = state.activePlayer) {
    if (state.status !== "ACTIVE" || pid !== state.activePlayer) {
      return [];
    }
    const p = state.players[pid];
    if (!p || !p.alive) return [{ type: "END_TURN", costAp: 0, costEnergy: 0, desc: "End turn" }];

    const moves = [];
    if (p.ap > 0) {
      const owned = Object.values(state.cells).filter((c) => c.owner === pid);

      // 1. DEPLOY (cost 1 AP, 2 Energy -> +2 units on owned hex, max 8)
      if (p.energy >= 2) {
        for (const c of owned) {
          if (c.units < 8) {
            moves.push({
              type: "DEPLOY",
              target: c.key,
              q: c.q,
              r: c.r,
              costAp: 1,
              costEnergy: 2,
              desc: `Deploy +2 units at (${c.q},${c.r}) [${c.type}]`
            });
          }
        }
      }

      // 2. MARCH (cost 1 AP, 0 Energy -> move 1..units-1 or all units to adjacent non-RIFT hex)
      for (const c of owned) {
        if (c.units >= 2) {
          const neighbors = getNeighbors(c.q, c.r, state.cells);
          for (const n of neighbors) {
            if (n.type === "RIFT") continue;
            // Offer standard tactical march (leave 1 garrison behind) and full-commit march (if >2 units and not home citadel)
            const leaveOneCount = c.units - 1;
            moves.push({
              type: "MARCH",
              from: c.key,
              to: n.key,
              units: leaveOneCount,
              costAp: 1,
              costEnergy: 0,
              desc: `March ${leaveOneCount} units (${c.q},${c.r}) -> (${n.q},${n.r})`
            });
            if (c.units >= 3 && c.type !== "CITADEL") {
              moves.push({
                type: "MARCH",
                from: c.key,
                to: n.key,
                units: c.units,
                costAp: 1,
                costEnergy: 0,
                desc: `All-in March ${c.units} units (${c.q},${c.r}) -> (${n.q},${n.r})`
              });
            }
          }
        }
      }

      // 3. FORTIFY (cost 1 AP, 2 Energy -> place Aegis Shield +1 unit on owned unshielded hex)
      if (p.energy >= 2) {
        for (const c of owned) {
          if (!c.shielded) {
            moves.push({
              type: "FORTIFY",
              target: c.key,
              q: c.q,
              r: c.r,
              costAp: 1,
              costEnergy: 2,
              desc: `Fortify (${c.q},${c.r}) with Aegis Shield (+1 unit)`
            });
          }
        }
      }

      // 4. PULSE (cost 1 AP, 4 Energy -> EMP strike within range 2 of any owned hex)
      if (p.energy >= 4) {
        const enemyCells = Object.values(state.cells).filter(
          (c) => c.owner !== null && c.owner !== pid && (c.units > 1 || c.shielded)
        );
        for (const ec of enemyCells) {
          const inRange = owned.some((oc) => hexDist(oc.q, oc.r, ec.q, ec.r) <= 2);
          if (inRange) {
            moves.push({
              type: "PULSE",
              target: ec.key,
              q: ec.q,
              r: ec.r,
              costAp: 1,
              costEnergy: 4,
              desc: `Orbital EMP Pulse on (${ec.q},${ec.r}) [-2 enemy units & strip shield]`
            });
          }
        }
      }
    }

    moves.push({
      type: "END_TURN",
      costAp: 0,
      costEnergy: 0,
      desc: "End turn and harvest territory yield"
    });

    return moves;
  }

  function resolveCombat(state, attackerPid, fromCell, toCell, sentUnits) {
    const p = state.players[attackerPid];
    if (toCell.owner === attackerPid) {
      // Friendly reinforcement
      const combined = Math.min(9, toCell.units + sentUnits);
      toCell.units = combined;
      appendLog(
        state,
        attackerPid,
        "MARCH_REINFORCE",
        `${p.name} reinforced (${toCell.q},${toCell.r}) with ${sentUnits} units (now ${toCell.units}).`
      );
      return { outcome: "REINFORCED", cell: toCell.key };
    }

    const defOwner = toCell.owner;
    const defName = defOwner === null ? "Neutral Sentries" : state.players[defOwner].name;
    const shieldPenalty = toCell.shielded ? 1 : 0;
    const effectiveDefense = toCell.units + shieldPenalty;

    if (sentUnits > effectiveDefense) {
      const survivors = Math.max(1, sentUnits - effectiveDefense);
      const prevType = toCell.type;
      toCell.owner = attackerPid;
      toCell.units = survivors;
      toCell.shielded = false;

      // Instant capture bonus
      let vpBonus = 0;
      let energyBonus = 0;
      if (prevType === "NEXUS") vpBonus = 2;
      else if (prevType === "CITADEL") vpBonus = 2;
      else if (prevType === "RELAY") energyBonus = 2;

      p.vp += vpBonus;
      p.energy = Math.min(12, p.energy + energyBonus);

      appendLog(
        state,
        attackerPid,
        "CAPTURE",
        `${p.name} captured ${prevType} (${toCell.q},${toCell.r}) from ${defName} (${survivors} unit${survivors > 1 ? "s" : ""} surviving${vpBonus ? `, +${vpBonus} VP` : ""}${energyBonus ? `, +${energyBonus}⚡` : ""})!`
      );

      checkWinCondition(state);
      return { outcome: "CAPTURED", cell: toCell.key, survivors };
    } else if (sentUnits === effectiveDefense) {
      // Mutual attrition: defender holds with 1 unit, shield breaks
      toCell.units = 1;
      toCell.shielded = false;
      appendLog(
        state,
        attackerPid,
        "CLASH_DRAW",
        `${p.name} clashed with ${defName} at (${toCell.q},${toCell.r}) — defender barely held with 1 unit!`
      );
      return { outcome: "REPELLED_BARELY", cell: toCell.key };
    } else {
      // Defender repels easily
      const remainingDef = Math.max(1, effectiveDefense - sentUnits);
      toCell.units = remainingDef;
      toCell.shielded = false;
      appendLog(
        state,
        attackerPid,
        "CLASH_REPELLED",
        `${p.name}'s assault on (${toCell.q},${toCell.r}) was repelled by ${defName} (${remainingDef} defenders remain).`
      );
      return { outcome: "REPELLED", cell: toCell.key };
    }
  }

  function applyMove(state, move) {
    if (state.status !== "ACTIVE") {
      return { ok: false, error: "Match is already finished." };
    }
    const pid = state.activePlayer;
    const p = state.players[pid];
    if (!move || typeof move.type !== "string") {
      return { ok: false, error: "Move must include a valid 'type' string." };
    }

    const actionType = move.type.toUpperCase();

    if (actionType === "END_TURN") {
      advanceTurn(state);
      return { ok: true, state };
    }

    if (p.ap <= 0) {
      return { ok: false, error: "No Action Points (AP) remaining this turn. Submit END_TURN." };
    }

    if (actionType === "DEPLOY") {
      const cell = state.cells[move.target];
      if (!cell || cell.owner !== pid) {
        return { ok: false, error: "DEPLOY target must be an owned hex." };
      }
      if (p.energy < 2) {
        return { ok: false, error: "DEPLOY requires 2 Energy." };
      }
      if (cell.units >= 8) {
        return { ok: false, error: "Hex is already at max unit capacity (8)." };
      }
      p.ap -= 1;
      p.energy -= 2;
      cell.units = Math.min(8, cell.units + 2);
      appendLog(
        state,
        pid,
        "DEPLOY",
        `${p.name} deployed +2 units at (${cell.q},${cell.r}) [now ${cell.units}].`
      );
    } else if (actionType === "MARCH") {
      const fromCell = state.cells[move.from];
      const toCell = state.cells[move.to];
      if (!fromCell || fromCell.owner !== pid) {
        return { ok: false, error: "MARCH 'from' must be an owned hex." };
      }
      if (!toCell || toCell.type === "RIFT") {
        return { ok: false, error: "MARCH 'to' must be a valid non-RIFT hex." };
      }
      if (hexDist(fromCell.q, fromCell.r, toCell.q, toCell.r) !== 1) {
        return { ok: false, error: "MARCH 'to' must be adjacent (distance 1)." };
      }
      if (fromCell.units < 2) {
        return { ok: false, error: "Source hex needs at least 2 units to march." };
      }
      const sent = move.units ? Math.min(fromCell.units, Math.max(1, Number(move.units))) : fromCell.units - 1;
      fromCell.units -= sent;
      if (fromCell.units === 0) {
        // Hex remains owned by player with 0 garrison unless captured, but minimum 1 garrison is safer for visuals
        fromCell.units = 1;
      }
      p.ap -= 1;
      resolveCombat(state, pid, fromCell, toCell, sent);
    } else if (actionType === "FORTIFY") {
      const cell = state.cells[move.target];
      if (!cell || cell.owner !== pid) {
        return { ok: false, error: "FORTIFY target must be an owned hex." };
      }
      if (p.energy < 2) {
        return { ok: false, error: "FORTIFY requires 2 Energy." };
      }
      if (cell.shielded) {
        return { ok: false, error: "Hex is already shielded." };
      }
      p.ap -= 1;
      p.energy -= 2;
      cell.shielded = true;
      cell.units = Math.min(8, cell.units + 1);
      appendLog(
        state,
        pid,
        "FORTIFY",
        `${p.name} fortified (${cell.q},${cell.r}) with an Aegis Shield (+1 unit, now ${cell.units}).`
      );
    } else if (actionType === "PULSE") {
      const cell = state.cells[move.target];
      if (!cell || cell.owner === null || cell.owner === pid) {
        return { ok: false, error: "PULSE target must be an enemy-occupied hex." };
      }
      if (p.energy < 4) {
        return { ok: false, error: "PULSE requires 4 Energy." };
      }
      const owned = Object.values(state.cells).filter((c) => c.owner === pid);
      const inRange = owned.some((oc) => hexDist(oc.q, oc.r, cell.q, cell.r) <= 2);
      if (!inRange) {
        return { ok: false, error: "PULSE target must be within 2 hexes of your territory." };
      }
      p.ap -= 1;
      p.energy -= 4;
      const oldUnits = cell.units;
      cell.units = Math.max(1, cell.units - 2);
      cell.shielded = false;
      appendLog(
        state,
        pid,
        "PULSE",
        `${p.name} fired an Orbital EMP Pulse at (${cell.q},${cell.r})! Enemy garrison dropped ${oldUnits} -> ${cell.units} and lost shielding.`
      );
    } else {
      return { ok: false, error: `Unknown move type: ${actionType}` };
    }

    checkWinCondition(state);
    saveSnapshot(state, `R${state.round} P${pid + 1}: ${actionType}`);

    // Auto-advance turn if player spent all AP and game is still active
    if (state.status === "ACTIVE" && p.ap <= 0) {
      advanceTurn(state);
    }

    return { ok: true, state };
  }

  function advanceTurn(state) {
    if (state.status !== "ACTIVE") return;
    const prevPid = state.activePlayer;
    const prevPlayer = state.players[prevPid];

    // End-of-turn harvest for the player finishing their turn
    const stats = getPlayerTerritoryStats(state, prevPid);
    const energyGain = 2 + stats.citadels + stats.relays * 2 + (stats.hasNexus ? 1 : 0);
    const vpGain =
      stats.citadels * 1 +
      (stats.hasNexus ? 3 : 0) +
      Math.floor(stats.hexCount / 3);

    prevPlayer.energy = Math.min(12, prevPlayer.energy + energyGain);
    prevPlayer.vp += vpGain;

    appendLog(
      state,
      prevPid,
      "END_TURN",
      `${prevPlayer.name} ended turn: harvested +${energyGain}⚡ (now ${prevPlayer.energy}⚡) and +${vpGain} VP (now ${prevPlayer.vp} VP).`
    );

    if (checkWinCondition(state)) {
      saveSnapshot(state, `Match End — Winner: ${state.players[state.winner].name}`);
      return;
    }

    // Move to next player
    let nextPid = (prevPid + 1) % state.numPlayers;
    if (nextPid === 0) {
      state.round += 1;
      if (state.round > state.maxRounds) {
        finalizeMaxRoundWinner(state);
        saveSnapshot(state, `Match End (Round Limit)`);
        return;
      }
    }

    state.activePlayer = nextPid;
    state.turnIndex += 1;
    const nextPlayer = state.players[nextPid];
    nextPlayer.ap = 2;

    saveSnapshot(state, `R${state.round} Turn: ${nextPlayer.name}`);
  }

  function checkWinCondition(state) {
    if (state.status !== "ACTIVE") return true;

    // 1. Check immediate VP threshold
    for (const p of state.players) {
      if (p.vp >= state.targetVp) {
        state.status = "FINISHED";
        state.winner = p.id;
        state.winReason = `${p.name} achieved Nexus Supremacy (${p.vp} / ${state.targetVp} VP)!`;
        appendLog(state, p.id, "VICTORY", state.winReason);
        return true;
      }
    }

    // 2. Check Total Domination (controls all Citadels)
    const citadelOwners = new Set();
    for (const c of Object.values(state.cells)) {
      if (c.type === "CITADEL" && c.owner !== null) {
        citadelOwners.add(c.owner);
      }
    }
    if (citadelOwners.size === 1 && state.round >= 2) {
      const soleOwner = Array.from(citadelOwners)[0];
      const winnerP = state.players[soleOwner];
      state.status = "FINISHED";
      state.winner = soleOwner;
      state.winReason = `${winnerP.name} conquered all Citadels on the board!`;
      appendLog(state, soleOwner, "VICTORY", state.winReason);
      return true;
    }

    return false;
  }

  function finalizeMaxRoundWinner(state) {
    const ranked = [...state.players].sort((a, b) => {
      if (b.vp !== a.vp) return b.vp - a.vp;
      const sa = getPlayerTerritoryStats(state, a.id);
      const sb = getPlayerTerritoryStats(state, b.id);
      if (sb.hexCount !== sa.hexCount) return sb.hexCount - sa.hexCount;
      return sb.totalUnits - sa.totalUnits;
    });
    const best = ranked[0];
    state.status = "FINISHED";
    state.winner = best.id;
    state.winReason = `Round ${state.maxRounds} completed — ${best.name} wins on Victory Points (${best.vp} VP)!`;
    appendLog(state, best.id, "VICTORY", state.winReason);
  }

  /**
   * Built-in Heuristic AI Bot Decision Engine
   * Personalities:
   * - AGGRESSOR: prioritizes Nexus & enemy Citadels, EMP Pulses, and offensive marches
   * - HARVESTER: prioritizes Energy Relays, Fortifying key nodes, and steady expansion
   * - TACTICIAN: balanced multi-factor evaluation (default)
   */
  function chooseBotMove(state, personality = "TACTICIAN") {
    const pid = state.activePlayer;
    const p = state.players[pid];
    const legal = getLegalMoves(state, pid);
    if (legal.length <= 1) return { type: "END_TURN" };

    const persona = String(personality || p.role || "TACTICIAN").toUpperCase();
    let bestMove = { type: "END_TURN" };
    let bestScore = -1;

    for (const m of legal) {
      if (m.type === "END_TURN") continue;
      let score = 0;

      if (m.type === "MARCH") {
        const fromCell = state.cells[m.from];
        const toCell = state.cells[m.to];
        const distToCenter = hexDist(toCell.q, toCell.r, 0, 0);

        if (toCell.owner !== pid) {
          const effDef = toCell.units + (toCell.shielded ? 1 : 0);
          if (m.units > effDef) {
            // Winning capture!
            score += 45;
            if (toCell.type === "NEXUS") score += persona.includes("AGGRESSOR") ? 70 : 55;
            if (toCell.type === "CITADEL") score += 85;
            if (toCell.type === "RELAY") score += persona.includes("HARVESTER") ? 60 : 40;
            if (toCell.owner !== null) score += 20; // Taking from rival is worth double
            score += (3 - distToCenter) * 5;
          } else if (m.units === effDef && toCell.type === "NEXUS" && persona.includes("AGGRESSOR")) {
            score += 18;
          } else {
            score -= 50; // Avoid suicide marches
          }
        } else {
          // Friendly reinforcement toward frontline or Nexus
          const fromDist = hexDist(fromCell.q, fromCell.r, 0, 0);
          if (distToCenter < fromDist && toCell.units <= 5) {
            score += 18 + (fromDist - distToCenter) * 6;
          } else {
            score -= 10;
          }
        }
        // Avoid leaving home citadel weak if enemy is nearby
        if (fromCell.type === "CITADEL" && fromCell.units - m.units < 2) {
          score -= 15;
        }
      } else if (m.type === "DEPLOY") {
        const cell = state.cells[m.target];
        const neighbors = getNeighbors(cell.q, cell.r, state.cells);
        const adjacentEnemies = neighbors.filter((n) => n.owner !== pid && n.type !== "RIFT");
        score += 24;
        if (cell.type === "NEXUS") score += 25;
        if (cell.type === "CITADEL" && cell.units <= 3) score += 20;
        if (adjacentEnemies.length > 0) score += adjacentEnemies.length * 10;
        if (cell.units >= 6) score -= 18;
      } else if (m.type === "FORTIFY") {
        const cell = state.cells[m.target];
        const neighbors = getNeighbors(cell.q, cell.r, state.cells);
        const enemyThreat = neighbors.some((n) => n.owner !== null && n.owner !== pid);
        if (cell.type === "NEXUS") score += 48;
        else if (cell.type === "RELAY" && persona.includes("HARVESTER")) score += 38;
        else if (cell.type === "CITADEL" && enemyThreat) score += 42;
        else if (enemyThreat && cell.units >= 3) score += 28;
        else score += 8;
      } else if (m.type === "PULSE") {
        const cell = state.cells[m.target];
        score += 36;
        if (cell.type === "NEXUS" || cell.type === "CITADEL") score += 30;
        if (cell.shielded) score += 20;
        if (persona.includes("AGGRESSOR")) score += 15;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
    }

    return bestScore > 5 ? bestMove : { type: "END_TURN" };
  }

  return {
    FACTIONS,
    HEX_DIRS,
    hexKey,
    hexDist,
    getNeighbors,
    createMatch,
    getLegalMoves,
    applyMove,
    advanceTurn,
    chooseBotMove,
    getPlayerTerritoryStats
  };
});
