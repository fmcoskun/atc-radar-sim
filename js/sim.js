"use strict";
/* ==========================================================================
   sim.js — world model, traffic, navigation, conflicts, scoring, recording
   ========================================================================== */

/* ---------- helpers ---------- */

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deg2rad = (d) => (d * Math.PI) / 180;
const norm360 = (d) => ((d % 360) + 360) % 360;
const angleDiff = (a, b) => norm360(a - b + 180) - 180;
const pad = (n, w = 3) => String(Math.round(n)).padStart(w, "0");
const rgba = (c, a) => `rgba(${c},${a})`;
const bearingOf = (dx, dy) => norm360((Math.atan2(dx, dy) * 180) / Math.PI);
const polar = (brg, d) => ({ x: Math.sin(deg2rad(brg)) * d, y: Math.cos(deg2rad(brg)) * d });
const num = (v, def = 0) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : def);
const vsArrow = (vs) => (vs > 50 ? "↗" : vs < -50 ? "↘" : "");

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

const fmtMinSec = (sec) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtAlt = (ft) => (ft <= 0 ? "SFC" : `FL${pad(ft / 100)}`);

/* ---------- config ---------- */

const WORLD_RADIUS = 30;   // NM — simulated traffic lives inside this circle
const LIVE_RADIUS = 60;    // NM — live data query radius
const PLANE_COUNT = 10;
const SEP_H = 5;           // NM
const SEP_V = 1000;        // ft
const LOOKAHEAD = 120;     // s
const GS_FT_PER_NM = 318;  // 3° glide slope
const SNAPSHOT_EVERY = 1;  // s (sim)
const REPLAY_MAX = 3600;   // snapshots kept (1 h sim)
const LOG_MAX = 500;

const PREFIXES = ["DAL", "UAL", "AAL", "SWA", "BAW", "AFR", "DLH", "THY", "PGT", "KLM"];
const TYPES = ["A320", "A321", "B738", "B77W", "A359", "B789", "E190", "A333"];
const AIRPORTS = ["LTFJ", "LTAI", "LTBJ", "EDDF", "EGLL", "LFPG", "EHAM",
                  "LIRF", "LEMD", "KJFK", "OMDB", "LOWW", "LSZH"];
const EMERGENCY = { 7700: "EMRG", 7600: "RDOF", 7500: "HIJK" };

/* ---------- airspace ---------- */

const AIRPORT = { icao: "LTFM", lat: 41.2753, lon: 28.7519, rwy: "35L", course: 350 };
const RWY_HALF = 1; // NM
const APP_BRG = norm360(AIRPORT.course + 180);
const THR = polar(APP_BRG, RWY_HALF);          // landing threshold
const RWY_END = polar(AIRPORT.course, RWY_HALF);
const ILS_LEN = 15;

const FIXES = {
  ERKAL: { x: -27, y: 4 },  BOSRA: { x: -13, y: 6 },  TUZLA: { x: 6, y: 9 },
  MENEK: { x: 27, y: 12 },  NIKEL: { x: -8, y: 27 },  RAMOS: { x: 10, y: -8 },
  VEDAT: { x: 14, y: -26 }, OLMAK: { x: -26, y: -14 }, PELIT: { x: -12, y: -9 },
  SEDEF: { x: 26, y: -4 },
  KOPRU: { x: THR.x + polar(APP_BRG, 14).x, y: THR.y + polar(APP_BRG, 14).y }, // IAF
};

const AIRWAYS = [
  { name: "UA1", fixes: ["ERKAL", "BOSRA", "TUZLA", "MENEK"] },
  { name: "UB2", fixes: ["NIKEL", "TUZLA", "RAMOS", "VEDAT"] },
  { name: "UG3", fixes: ["OLMAK", "PELIT", "RAMOS", "SEDEF"] },
];

const ENDPOINTS = [...new Set(AIRWAYS.flatMap((a) => [a.fixes[0], a.fixes[a.fixes.length - 1]]))];

const AREAS = [
  { name: "LT-R12", type: "circle", x: -6, y: -21, r: 3.5, lo: 0, hi: 15000 },
  { name: "LT-D4", type: "poly", pts: [[12, 13], [20, 15], [21, 22], [13, 22]], lo: 10000, hi: 25000 },
];

/* ---------- state ---------- */

/** Callbacks the UI layer plugs in (sound, label reset) so sim.js stays free of DOM code. */
const hooks = { alarm() {}, sweep() {}, reset() {} };

const emptyScore = () => ({ points: 0, resolved: 0, violations: 0, infringements: 0, landed: 0, departed: 0 });

const state = {
  planes: [],
  view: { planes: [], conflicts: [], t: 0 },
  range: 15,
  rpm: 15,
  simSpeed: 1,
  playing: true,
  sweep: 0,
  simTime: 0,
  nextEngineer: 75,
  nextEmergency: 300,
  selectedCs: null,
  projection: true,
  ruler: { active: false, a: null, b: null },
  mouse: null,
  sound: false,
  sortKey: "cs",
  sortDir: 1,
  conflicts: [],
  pairs: new Map(),
  wind: { dir: 240, spd: 25 },
  wx: [],
  clutter: [],
  layers: { map: true, wx: true, areas: true, clutter: true },
  flMin: 0,
  flMax: 600,
  training: false,
  autoSpawn: true,
  score: emptyScore(),
  source: "sim",
  live: { timer: null, busy: false, rtt: null, error: null },
  log: [],
  logDirty: true,
  history: [],
  nextSnapshot: 0,
  replay: { active: false, t: 0 },
  scenarioName: "@scn.random",  // "@key" = translated name of a built-in scenario
  preview: null,     // { cs, path, losses } — clearance being typed/hovered, drawn on the scope
  vectorDrag: null,  // { cs, hdg, moved } — heading being dragged on the scope
};

/* ---------- event log ---------- */

/** Log entries keep an i18n key + params so they follow language changes. */
function logEvent(type, key, params = {}, cs = []) {
  state.log.unshift({
    t: state.simTime,
    utc: new Date().toISOString().slice(11, 19) + "Z",
    type,
    key,
    params,
    cs,
  });
  if (state.log.length > LOG_MAX) state.log.pop();
  state.logDirty = true;
}

const logText = (e) => i18n(e.key, e.params);

/** Only training mode keeps score; counters (landed etc.) always run. */
function addPoints(n) {
  if (state.training) state.score.points += n;
}

/** Display FL filter. Hidden targets are still separated, but do not sound alarms. */
function passFilter(p) {
  if (p.primary) return true;
  const fl = p.alt / 100;
  return fl >= state.flMin && fl <= state.flMax;
}

/* ---------- wind ---------- */

function windVec() {
  const to = deg2rad(state.wind.dir + 180);
  const s = state.wind.spd / 3600;
  return [Math.sin(to) * s, Math.cos(to) * s];
}

/** Heading to fly so the ground track equals `track` (wind correction angle). */
function headingForTrack(track, tas) {
  if (!tas) return track;
  const cw = state.wind.spd * Math.sin(deg2rad(state.wind.dir + 180 - track));
  return norm360(track - (Math.asin(clamp(cw / tas, -1, 1)) * 180) / Math.PI);
}

function updateGround(p) {
  const r = deg2rad(p.hdg);
  const s = p.spd / 3600;
  let wx = 0, wy = 0;
  if (!p.live) [wx, wy] = windVec();
  p.vx = Math.sin(r) * s + wx;
  p.vy = Math.cos(r) * s + wy;
  p.gs = Math.hypot(p.vx, p.vy) * 3600;
  p.trk = bearingOf(p.vx, p.vy);
}

function updateWind(dt) {
  state.wind.dir = norm360(state.wind.dir + (Math.random() - 0.5) * 0.6 * dt);
  state.wind.spd = clamp(state.wind.spd + (Math.random() - 0.5) * 0.15 * dt, 5, 45);
}

/* ---------- weather ---------- */

function makeCell(x, y, r) {
  const blobs = Array.from({ length: randInt(6, 10) }, () => ({
    dx: rand(-0.6, 0.6) * r,
    dy: rand(-0.6, 0.6) * r,
    r: rand(0.35, 0.7) * r,
    i: rand(0.4, 1),
  }));
  return { x, y, r, blobs };
}

function makeWeather(n) {
  return Array.from({ length: n }, () => {
    const p = polar(rand(0, 360), rand(8, 22));
    return makeCell(p.x, p.y, rand(2.5, 4.5));
  });
}

function updateWeather(dt) {
  const [wx, wy] = windVec();
  state.wx.forEach((c, i) => {
    c.x += wx * dt;
    c.y += wy * dt;
    if (Math.hypot(c.x, c.y) > WORLD_RADIUS + 6) {
      // re-enter on the upwind side
      const from = deg2rad(state.wind.dir);
      const off = rand(-15, 15);
      const nx = Math.sin(from) * (WORLD_RADIUS + 4) + Math.cos(from) * off;
      const ny = Math.cos(from) * (WORLD_RADIUS + 4) - Math.sin(from) * off;
      state.wx[i] = makeCell(nx, ny, rand(2.5, 4.5));
    }
  });
}

/** -1 = turn left, +1 = turn right, 0 = clear */
function wxAhead(p) {
  const t = deg2rad(p.trk);
  for (const c of state.wx) {
    for (const d of [0, 2.5, 5]) {
      const ax = p.x + Math.sin(t) * d, ay = p.y + Math.cos(t) * d;
      if (Math.hypot(ax - c.x, ay - c.y) < c.r + 0.5) {
        const cross = Math.sin(t) * (c.y - p.y) - Math.cos(t) * (c.x - p.x);
        return cross < 0 ? -1 : 1; // cell on the right → go left
      }
    }
  }
  return 0;
}

/* ---------- restricted areas ---------- */

function inArea(a, x, y) {
  if (a.type === "circle") return Math.hypot(x - a.x, y - a.y) <= a.r;
  let inside = false;
  for (let i = 0, j = a.pts.length - 1; i < a.pts.length; j = i++) {
    const [xi, yi] = a.pts[i], [xj, yj] = a.pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function checkAreas(p) {
  if (p.live) return; // the restricted areas are fictional; real traffic is not checked against them
  let hit = null;
  for (const a of AREAS) {
    if (inArea(a, p.x, p.y) && (p.primary || (p.alt >= a.lo && p.alt <= a.hi))) hit = a.name;
  }
  if (hit && hit !== p.areaAlert) {
    state.score.infringements++;
    addPoints(-100);
    logEvent("AREA", "log.area", { cs: p.cs, area: hit }, [p.cs]);
    if (passFilter(p)) hooks.alarm();
  }
  p.areaAlert = hit;
}

/* ---------- traffic ---------- */

const usedCallsigns = new Set();
let primaryCounter = 0;

function claimCallsign(want) {
  let cs = want, n = 2;
  while (usedCallsigns.has(cs)) cs = `${want}-${n++}`;
  usedCallsigns.add(cs);
  return cs;
}

function newCallsign() {
  let cs;
  do cs = pick(PREFIXES) + randInt(100, 999);
  while (usedCallsigns.has(cs));
  return claimCallsign(cs);
}

function randomSquawk() {
  let s;
  do s = Array.from({ length: 4 }, () => randInt(0, 7)).join("");
  while (EMERGENCY[s]);
  return s;
}

function cruiseSpeed(alt) {
  return alt <= 10000 ? randInt(180, 250) : randInt(300, 460);
}

function makePlane(o = {}) {
  const primary = !!o.primary;
  const alt = o.alt ?? randInt(8, 38) * 1000;
  const origin = o.origin ?? pick(AIRPORTS);
  let dest = o.dest;
  if (!dest) do dest = pick(AIRPORTS); while (dest === origin);

  const p = {
    cs: o.cs ? claimCallsign(o.cs) : primary ? claimCallsign(`PRI${pad(++primaryCounter, 2)}`) : newCallsign(),
    type: o.type ?? (primary ? "----" : pick(TYPES)),
    squawk: primary ? "----" : o.squawk ?? randomSquawk(),
    origin,
    dest,
    primary,
    live: !!o.live,
    x: o.x ?? 0,
    y: o.y ?? 0,
    hdg: o.hdg ?? rand(0, 360),
    assignedHdg: o.assignedHdg ?? null,
    desiredHdg: null,
    route: o.route ? [...o.route] : [],
    alt,
    targetAlt: o.targetAlt ?? alt,
    climbRate: o.climbRate ?? randInt(1200, 2500),
    vs: 0,
    spd: o.spd ?? cruiseSpeed(alt),
    spdAssigned: false,
    arrival: !!o.arrival,
    ilsCleared: !!o.ilsCleared,
    ilsState: null,
    noIlsUntil: 0,
    departureExit: o.departureExit ?? null,
    controlled: false,
    lockUntil: o.lockUntil ?? 0,
    emergency: null,
    areaAlert: null,
    wxAvoid: null,
    landed: false,
    disp: null,
    paintAngle: 0,
    trail: [],
    status: "NORMAL",
    vx: 0, vy: 0, gs: 0, trk: 0,
  };
  p.targetSpd = o.targetSpd ?? p.spd;
  if (!primary && EMERGENCY[p.squawk]) setEmergency(p, p.squawk, false);
  updateGround(p);
  return p;
}

function setEmergency(p, code, announce = true) {
  p.squawk = code;
  p.emergency = code;
  if (code === "7700" && !p.live && !p.diverted) {
    // Declared emergency: priority approach (remember the plan so NORMAL can restore it)
    p.diverted = {
      arrival: p.arrival, dest: p.dest, ilsCleared: p.ilsCleared, route: [...p.route],
      departureExit: p.departureExit, assignedHdg: p.assignedHdg, targetAlt: p.targetAlt, lockUntil: p.lockUntil,
    };
    p.arrival = true;
    p.dest = AIRPORT.icao;
    p.ilsCleared = true;
    p.lockUntil = Infinity;
    p.targetAlt = Math.min(p.targetAlt, 7000);
  }
  if (announce) {
    logEvent("EMERGENCY", "log.emergency", { cs: p.cs, code, label: EMERGENCY[code] }, [p.cs]);
    if (passFilter(p)) hooks.alarm();
  }
}

function clearEmergency(p) {
  if (!p.emergency) return;
  logEvent("EMERGENCY", "log.emergencyEnd", { cs: p.cs }, [p.cs]);
  p.emergency = null;
  p.squawk = randomSquawk();
  const d = p.diverted;
  if (d && p.ilsState !== "LOC") {
    // back to the original plan unless already established on the approach
    Object.assign(p, { ...d, route: d.route });
    if (d.arrival) p.ilsCleared = d.ilsCleared || !state.training;
  }
  p.diverted = null;
}

function pickKind() {
  const r = Math.random();
  return r < 0.4 ? "airway" : r < 0.65 ? "arrival" : r < 0.8 ? "departure" : "random";
}

function edgePoint() {
  const ang = rand(0, 360);
  return { ...polar(ang, WORLD_RADIUS * 0.97), inbound: norm360(ang + 180 + rand(-35, 35)) };
}

function spawnPlane(kind, initial = false) {
  switch (kind) {
    case "airway": {
      const aw = pick(AIRWAYS);
      const fixes = Math.random() < 0.5 ? aw.fixes : [...aw.fixes].reverse();
      let pos, route;
      if (initial) {
        const i = randInt(0, fixes.length - 2);
        const t = Math.random();
        const A = FIXES[fixes[i]], B = FIXES[fixes[i + 1]];
        pos = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
        route = fixes.slice(i + 1);
      } else {
        pos = { ...FIXES[fixes[0]] };
        route = fixes.slice(1);
      }
      const f = FIXES[route[0]];
      return makePlane({ x: pos.x, y: pos.y, hdg: bearingOf(f.x - pos.x, f.y - pos.y), alt: randInt(18, 39) * 1000, route });
    }
    case "arrival": {
      const pos = initial ? polar(rand(0, 360), rand(16, 26)) : { ...FIXES[pick(ENDPOINTS)] };
      const k = FIXES.KOPRU;
      return makePlane({
        x: pos.x, y: pos.y,
        hdg: bearingOf(k.x - pos.x, k.y - pos.y),
        alt: randInt(11, 20) * 1000, targetAlt: 7000,
        route: ["KOPRU"], arrival: true, dest: AIRPORT.icao,
        ilsCleared: !state.training,
      });
    }
    case "departure": {
      const d = initial ? rand(2, 8) : 0;
      const pos = { x: THR.x + polar(AIRPORT.course, d).x, y: THR.y + polar(AIRPORT.course, d).y };
      const p = makePlane({
        x: pos.x, y: pos.y,
        hdg: AIRPORT.course, assignedHdg: AIRPORT.course,
        alt: initial ? Math.round(d * 700) : 0, targetAlt: randInt(12, 24) * 1000, climbRate: 2500,
        spd: initial ? 230 : 150, targetSpd: 250,
        origin: AIRPORT.icao, departureExit: pick(ENDPOINTS),
      });
      if (!initial) {
        state.score.departed++;
        logEvent("DEP", "log.dep", { cs: p.cs, rwy: AIRPORT.rwy, exit: p.departureExit }, [p.cs]);
      }
      return p;
    }
    case "primary": {
      const e = edgePoint();
      const pos = initial ? polar(rand(0, 360), rand(6, 20)) : e;
      return makePlane({ primary: true, x: pos.x, y: pos.y, hdg: initial ? rand(0, 360) : e.inbound,
                         alt: randInt(20, 45) * 100, spd: randInt(90, 140) });
    }
    default: {
      if (initial) {
        const pos = polar(rand(0, 360), Math.sqrt(Math.random()) * 22);
        return makePlane({ x: pos.x, y: pos.y });
      }
      const e = edgePoint();
      return makePlane({ x: e.x, y: e.y, hdg: e.inbound });
    }
  }
}

/** Two aircraft at the same level converging on a point in `t` seconds. */
function makeConflictPair(t) {
  const m = { x: rand(-5, 5), y: rand(-5, 5) };
  const alt = randInt(18, 34) * 1000;
  const h1 = rand(0, 360);
  const h2 = norm360(h1 + pick([-1, 1]) * rand(70, 160));
  const mk = (h) => {
    const spd = randInt(320, 440);
    const d = (spd / 3600) * t;
    return makePlane({
      x: m.x - Math.sin(deg2rad(h)) * d,
      y: m.y - Math.cos(deg2rad(h)) * d,
      hdg: h, assignedHdg: h, alt, spd,
      lockUntil: t + 40,
    });
  };
  return [mk(h1), mk(h2)];
}

function engineerConflict() {
  const cands = state.planes.filter((p) =>
    !p.primary && !p.live && !p.arrival && !p.ilsCleared && !p.departureExit && !p.controlled &&
    !p.emergency && p.alt > 10000 && Math.hypot(p.x, p.y) < 18);
  for (let tries = 0; tries < 15; tries++) {
    const a = pick(cands), b = pick(cands);
    if (!a || !b || a === b) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 8 || d > 22 || Math.abs(a.alt - b.alt) > 8000) continue;

    let t = d / (b.spd / 3600);
    let ax = a.x, ay = a.y;
    for (let k = 0; k < 4; k++) {
      ax = a.x + a.vx * t;
      ay = a.y + a.vy * t;
      t = Math.hypot(ax - b.x, ay - b.y) / (b.gs / 3600 || 1e-3);
    }
    if (t > 200 || Math.hypot(ax, ay) > 20) continue;

    const lvl = Math.round(a.alt / 1000) * 1000;
    a.targetAlt = lvl;
    b.targetAlt = lvl;
    b.climbRate = 3000;
    b.route = [];
    b.assignedHdg = headingForTrack(bearingOf(ax - b.x, ay - b.y), b.spd);
    a.lockUntil = b.lockUntil = state.simTime + t + 40;
    return true;
  }
  return false;
}

/* ---------- navigation ---------- */

/** Position relative to the ILS: along = NM before threshold, xte = NM right of centreline. */
function ilsGeometry(p) {
  const u = deg2rad(AIRPORT.course);
  const dx = p.x - THR.x, dy = p.y - THR.y;
  return {
    along: -(dx * Math.sin(u) + dy * Math.cos(u)),
    xte: dx * Math.cos(u) - dy * Math.sin(u),
  };
}

function navigate(p) {
  let track = null;
  let hdg = null;

  if (p.departureExit && p.alt > 3000) {
    p.route = [p.departureExit];
    p.departureExit = null;
    p.assignedHdg = null;
  }

  // --- arrival descent profile (≈300 ft per track mile to touchdown) ---
  if (p.arrival && p.ilsState !== "LOC" && !p.altAssigned) {
    const k = FIXES.KOPRU;
    const trackMiles = Math.hypot(p.x - k.x, p.y - k.y) + 14;
    const profile = clamp(Math.round((trackMiles * 300) / 100) * 100, 4000, 15000);
    if (profile < p.targetAlt) {
      p.targetAlt = profile;
      p.climbRate = Math.max(p.climbRate, 2000);
    }
  }

  // --- ILS approach ---
  if (p.ilsCleared && state.simTime >= p.noIlsUntil) {
    const g = ilsGeometry(p);
    if (p.ilsState !== "LOC") {
      const k = FIXES.KOPRU;
      const facing = Math.abs(angleDiff(p.trk, AIRPORT.course)) < 100;
      const inSector = g.along > 3 && g.along < 25 && Math.abs(g.xte) < g.along * 0.7 && facing;
      if (inSector || Math.hypot(p.x - k.x, p.y - k.y) < 2.5) {
        p.ilsState = "LOC";
        p.route = [];
        p.assignedHdg = null;
        logEvent("ILS", "log.ils", { cs: p.cs, rwy: AIRPORT.rwy }, [p.cs]);
      } else if (p.route[0] !== "KOPRU") {
        p.route = ["KOPRU"];
      }
    }
    if (p.ilsState === "LOC") {
      track = norm360(AIRPORT.course - clamp(g.xte * 25, -45, 45));
      if (Math.abs(g.xte) < 2) {
        const glide = Math.round(g.along * GS_FT_PER_NM);
        p.targetAlt = Math.max(0, Math.min(p.targetAlt, glide));
        // above the glide slope → descend steeper to re-capture it
        p.climbRate = Math.max(p.climbRate, p.alt > glide + 300 ? 2500 : 1500);
      }
      if (p.spdAssigned && g.along < 4) p.spdAssigned = false; // "speed until 4 DME"
      if (!p.spdAssigned) p.targetSpd = g.along < 5 ? 140 : g.along < 12 ? 180 : Math.min(p.targetSpd, 220);
      if (g.along < 0.4 && Math.abs(g.xte) < 0.6 && p.alt < 1200) {
        p.landed = true;
        return;
      }
      if (g.along < -0.5) {
        // missed approach
        p.ilsState = null;
        p.ilsCleared = !state.training;
        p.noIlsUntil = state.simTime + 90;
        p.assignedHdg = AIRPORT.course;
        p.route = [];
        p.targetAlt = 4000;
        p.targetSpd = 210;
        track = null;
        logEvent("GO AROUND", "log.goAround", { cs: p.cs }, [p.cs]);
      }
    }
  }

  // --- route / heading ---
  if (track === null && p.route.length) {
    let f = FIXES[p.route[0]];
    if (!f || Math.hypot(f.x - p.x, f.y - p.y) < 1.5) {
      p.route.shift();
      f = FIXES[p.route[0]];
    }
    if (f) track = bearingOf(f.x - p.x, f.y - p.y);
    else if (!p.route.length) p.assignedHdg = p.hdg; // end of route: hold last heading
  }
  if (track === null) hdg = p.assignedHdg;

  // --- weather avoidance ---
  if (p.ilsState !== "LOC" && !p.primary) {
    if (!p.wxAvoid || state.simTime > p.wxAvoid.until) {
      const side = wxAhead(p);
      const wasAvoiding = !!p.wxAvoid;
      p.wxAvoid = side ? { sign: side, until: state.simTime + 25, base: track ?? hdg ?? p.trk } : null;
      if (side && !wasAvoiding && !(state.simTime - p.wxLoggedAt < 180)) {
        p.wxLoggedAt = state.simTime;
        logEvent("WX", side < 0 ? "log.wxLeft" : "log.wxRight", { cs: p.cs }, [p.cs]);
      }
    }
    if (p.wxAvoid) {
      if (track !== null) track = norm360(track + p.wxAvoid.sign * 45);
      else if (hdg !== null) hdg = norm360(hdg + p.wxAvoid.sign * 45);
      else track = norm360(p.wxAvoid.base + p.wxAvoid.sign * 45);
    }
  }

  p.desiredHdg = track !== null ? headingForTrack(track, p.spd) : hdg;
}

function projectedAlt(p, t) {
  if (p.live) return p.alt + (p.vs * t) / 60;
  const d = p.targetAlt - p.alt;
  return p.alt + Math.sign(d) * Math.min(Math.abs(d), (p.climbRate * t) / 60);
}

function updatePlane(p, dt) {
  if (p.live) {
    p.alt = Math.max(0, p.alt + (p.vs * dt) / 60);
    updateGround(p);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    checkAreas(p);
    return;
  }

  navigate(p);
  if (p.landed) return;

  // heading — standard rate turn
  if (p.desiredHdg !== null && p.desiredHdg !== undefined) {
    const diff = angleDiff(p.desiredHdg, p.hdg);
    const step = 3 * dt;
    p.hdg = Math.abs(diff) <= step ? p.desiredHdg : norm360(p.hdg + Math.sign(diff) * step);
  }

  // altitude
  const dAlt = p.targetAlt - p.alt;
  if (dAlt !== 0) {
    const step = (p.climbRate * dt) / 60;
    if (Math.abs(dAlt) <= step) {
      p.alt = p.targetAlt;
      p.vs = 0;
    } else {
      p.alt += Math.sign(dAlt) * step;
      p.vs = Math.sign(dAlt) * p.climbRate;
    }
  } else {
    p.vs = 0;
  }

  // speed (250 kt below FL100 unless assigned / on approach)
  if (!p.spdAssigned && p.ilsState !== "LOC" && !p.primary) {
    if (p.alt <= 10000 && p.targetSpd > 250) p.targetSpd = randInt(220, 250);
    if (p.alt > 12000 && p.targetSpd < 300) p.targetSpd = randInt(300, 460);
  }
  p.spd += clamp(p.targetSpd - p.spd, -2 * dt, 3 * dt);

  updateGround(p);
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // occasional manoeuvres for free-flying traffic
  const free = !p.controlled && !p.route.length && !p.arrival && !p.departureExit && !p.ilsCleared;
  if (free && state.simTime > p.lockUntil) {
    if (Math.random() < dt / 90) p.assignedHdg = norm360(p.hdg + pick([-1, 1]) * rand(20, 70));
    if (!p.primary && Math.random() < dt / 150) {
      p.targetAlt = clamp(p.alt + pick([-1, 1]) * randInt(2, 8) * 1000, 5000, 41000);
    }
  }

  checkAreas(p);
}

/* ---------- commands ---------- */

/**
 * Parse a clearance without changing anything. Returns { ok, msg } on error, or
 * { ok, actions, readback, probe } where `probe` ({hdg, alt, spd, fix}) describes the
 * trajectory change for the conflict probe (null when it can't be previewed, e.g. ILS).
 */
function parseCommand(p, text) {
  const fail = (key, params) => ({ ok: false, msg: i18n(key, params) });
  if (!p || p.live || p.primary) return fail("cmd.notCommandable");
  if (p.landed) return fail("cmd.landed", { cs: p.cs });
  if (p.emergency === "7600") return fail("cmd.nordo", { cs: p.cs });

  const tokens = String(text).toUpperCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return fail("cmd.empty");

  const actions = [];
  const readback = [];
  let probe = {};
  let changesPath = false; // HDG/FL/SPD/DCT/NAV — the clearances that can resolve a conflict
  // Remember where the aircraft was going so NAV can send it back after vectoring.
  const saveNav = () => {
    if (p.resume) return;
    const route = p.departureExit ? [p.departureExit] : [...p.route];
    if (route.length || p.ilsCleared) p.resume = { route, ils: p.ilsCleared };
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const arg = tokens[i + 1];
    const v = Number(arg);
    if (tok === "HDG" || tok === "H") {
      if (!(Number.isInteger(v) && v >= 1 && v <= 360)) return fail("cmd.hdgRange");
      actions.push(() => {
        saveNav();
        p.assignedHdg = v % 360; p.route = []; p.departureExit = null;
        p.ilsCleared = false; p.ilsState = null;
      });
      readback.push(`HDG ${pad(v)}`);
      if (probe) { probe.hdg = v % 360; delete probe.fix; }
      changesPath = true;
      i++;
    } else if (tok === "FL" || tok === "F" || tok === "ALT") {
      if (!(Number.isInteger(v) && v >= 10 && v <= 450)) return fail("cmd.flRange");
      actions.push(() => { p.targetAlt = v * 100; p.altAssigned = true; p.climbRate = Math.max(p.climbRate, 1800); });
      readback.push(`FL${pad(v)}`);
      if (probe) probe.alt = v * 100;
      changesPath = true;
      i++;
    } else if (tok === "SPD" || tok === "S") {
      if (!(v >= 120 && v <= 500)) return fail("cmd.spdRange");
      actions.push(() => { p.targetSpd = v; p.spdAssigned = true; });
      readback.push(`SPD ${v}`);
      if (probe) probe.spd = v;
      changesPath = true;
      i++;
    } else if (tok === "DCT" || tok === "D") {
      if (!FIXES[arg]) return fail("cmd.unknownFix", { fix: arg ?? "—" });
      actions.push(() => {
        p.route = [arg]; p.assignedHdg = null; p.departureExit = null;
        p.ilsCleared = false; p.ilsState = null; p.resume = null;
      });
      readback.push(`DCT ${arg}`);
      if (probe) { probe.fix = arg; delete probe.hdg; }
      changesPath = true;
      i++;
    } else if (tok === "NAV") {
      const back = p.resume;
      const route = back?.route.length ? back.route : p.arrival ? ["KOPRU"] : null;
      if (!route) return fail("cmd.noNav", { cs: p.cs });
      actions.push(() => {
        p.route = [...route]; p.assignedHdg = null;
        if (back?.ils || (p.arrival && !state.training)) p.ilsCleared = true;
        p.resume = null;
      });
      readback.push(`OWN NAVIGATION DCT ${route[0]}`);
      if (probe) { probe.fix = route[0]; delete probe.hdg; }
      changesPath = true;
    } else if (tok === "ILS" || tok === "APP") {
      actions.push(() => {
        p.ilsCleared = true; p.arrival = true; p.altAssigned = false;
        p.dest = AIRPORT.icao; p.assignedHdg = null; p.noIlsUntil = 0; p.resume = null;
      });
      readback.push(`CLEARED ILS ${AIRPORT.rwy}`);
      probe = null;
    } else if (tok === "RES") {
      actions.push(() => { p.spdAssigned = false; });
      readback.push("RESUME NORMAL SPEED");
    } else {
      return fail("cmd.unknown", { tok });
    }
  }
  return { ok: true, actions, readback, probe, changesPath };
}

function applyCommand(p, text) {
  const cmd = parseCommand(p, text);
  if (!cmd.ok) return cmd;
  const { actions, readback } = cmd;

  actions.forEach((fn) => fn());
  p.controlled = true; // no more random manoeuvres
  if (cmd.changesPath) {
    // only a trajectory change counts toward resolving this aircraft's open conflicts
    for (const [key, rec] of state.pairs) {
      if (key.split("|").includes(p.cs)) rec.commanded = true;
    }
  }
  const rb = readback.join(", ");
  logEvent("CMD", "log.cmd", { cs: p.cs, rb }, [p.cs]);
  return { ok: true, msg: `${p.cs}: ${rb}` };
}

/* ---------- conflict probe & resolution advisor ---------- */

const PROBE_T = 240;                 // s — how far ahead a clearance is checked (preview and advisories)
const PROBE_DT = 5;                  // s — forecast step
const PROBE_N = PROBE_T / PROBE_DT;
const ADVISE_BUFFER = 0.5;           // NM extra margin for advisories

const SEP_H_TMA = 3;       // NM — terminal-area radar minimum
const inTma = (p) => p.alt < 10000 && Math.hypot(p.x, p.y) < 25;

/** Horizontal minimum for a pair: 3 NM when both are inside the Istanbul TMA, 5 NM en route. */
function sepFor(a, b) {
  return inTma(a) && inTma(b) ? SEP_H_TMA : SEP_H;
}

/**
 * Pairs the radar separation check leaves alone: runway operations (tower), and in live
 * mode aircraft that are both on final / initial climb near LTFM, where the real airport
 * runs independent parallel runways that this one-runway model cannot represent.
 */
function pairExempt(a, b) {
  const near = (p, alt, r) => p.alt < alt && Math.hypot(p.x, p.y) < r;
  if ((a.alt < 1500 || b.alt < 1500) && near(a, Infinity, 5) && near(b, Infinity, 5)) return true;
  return state.source === "live" && near(a, 6000, 20) && near(b, 6000, 20);
}

const commandable = (p) => !!p && !p.live && !p.primary && !p.landed && p.emergency !== "7600";

/**
 * Kinematic forecast, one point every PROBE_DT seconds. Without `cmd` the target keeps
 * its present ground vector (the same assumption the conflict detector makes); with
 * `cmd` ({hdg, alt, spd, fix}) it turns at standard rate, climbs/descends and changes
 * speed toward the instructed values.
 */
function forecast(p, cmd = null) {
  const pts = new Array(PROBE_N + 1);
  if (!cmd || p.live) {
    for (let i = 0; i <= PROBE_N; i++) {
      const t = i * PROBE_DT;
      pts[i] = { x: p.x + p.vx * t, y: p.y + p.vy * t, alt: Math.max(0, projectedAlt(p, t)) };
    }
    return pts;
  }
  const [wx, wy] = windVec();
  let { x, y, alt, hdg, spd } = p;
  const tAlt = cmd.alt ?? p.targetAlt;
  const rate = cmd.alt != null ? Math.max(p.climbRate, 1800) : p.climbRate;
  const tSpd = cmd.spd ?? p.targetSpd;
  const fix = cmd.fix ? FIXES[cmd.fix] : null;
  for (let i = 0; i <= PROBE_N; i++) {
    pts[i] = { x, y, alt };
    let want = cmd.hdg ?? null;
    if (fix && Math.hypot(fix.x - x, fix.y - y) > 1.5) want = headingForTrack(bearingOf(fix.x - x, fix.y - y), spd);
    if (want !== null) {
      const d = angleDiff(want, hdg);
      const turn = 3 * PROBE_DT;
      hdg = Math.abs(d) <= turn ? want : norm360(hdg + Math.sign(d) * turn);
    }
    const dA = tAlt - alt;
    const climb = (rate * PROBE_DT) / 60;
    alt = Math.abs(dA) <= climb ? tAlt : alt + Math.sign(dA) * climb;
    spd += clamp(tSpd - spd, -2 * PROBE_DT, 3 * PROBE_DT);
    const r = deg2rad(hdg);
    x += (Math.sin(r) * spd / 3600 + wx) * PROBE_DT;
    y += (Math.cos(r) * spd / 3600 + wy) * PROBE_DT;
  }
  return pts;
}

/** When two forecasts lose separation: { t, end, i, steps, dh } or null. */
function lossWindow(A, B, sepH, n = PROBE_N) {
  let start = -1, end = -1, steps = 0, min = Infinity;
  for (let i = 0; i <= n; i++) {
    const dh = Math.hypot(A[i].x - B[i].x, A[i].y - B[i].y);
    if (dh < sepH && Math.abs(A[i].alt - B[i].alt) < SEP_V) {
      if (start < 0) start = i;
      end = i;
      steps++;
      min = Math.min(min, dh);
    }
  }
  return start < 0 ? null : { t: start * PROBE_DT, end: end * PROBE_DT, i: start, steps, dh: min };
}

/** Default forecasts of everything `p` must stay separated from. */
function trafficPaths(p) {
  return state.planes
    .filter((q) => q !== p && !q.primary && !q.landed && !pairExempt(p, q))
    .map((q) => ({ q, path: forecast(q) }));
}

/** Check a clearance for `p` against all other traffic. */
/**
 * Check a clearance for `p` against all other traffic. `opts.override` (Map cs → path)
 * substitutes forecasts of aircraft that receive a clearance at the same time.
 */
function probeCommand(p, cmd, traffic = trafficPaths(p), opts = {}) {
  const buffer = opts.buffer ?? 0;
  const n = opts.n ?? PROBE_N;
  const path = opts.path ?? forecast(p, cmd);
  const losses = [];
  for (const { q, path: base } of traffic) {
    const qp = opts.override?.get(q.cs) ?? base;
    const L = lossWindow(path, qp, sepFor(p, q) + buffer, n);
    if (L) losses.push({ cs: q.cs, at: qp[L.i], ...L });
  }
  losses.sort((a, b) => a.t - b.t);
  return { path, losses };
}

const levelText = (ft) => `FL ${pad(ft / 100)}`;

/** Small set of standard manoeuvres for one aircraft. */
function candidateCommands(p) {
  const out = [];
  const onLoc = p.ilsState === "LOC";
  if (!onLoc) {
    const base = Math.round(p.alt / 1000) * 1000;
    for (const k of [0, -1, 1, -2, 2]) {
      const lvl = base + k * 1000;
      if (lvl < 3000 || lvl > 41000 || Math.abs(lvl - p.targetAlt) < 500) continue;
      const upForArrival = p.arrival && lvl > p.alt ? 1.5 : 0;
      out.push({ cmd: { alt: lvl }, text: levelText(lvl), cost: 1 + Math.abs(k) * 0.5 + upForArrival });
    }
  }
  // on the localizer a turn means breaking off the approach — last resort
  const extra = onLoc ? 2.5 : p.route.length || p.ilsCleared || p.departureExit ? 0.5 : 0;
  // breaking off also needs a level, or it keeps descending to the glide-slope target
  const breakLvl = Math.max(4000, Math.ceil(p.alt / 1000) * 1000);
  for (const turn of onLoc ? [30, 45, 60] : [20, 30, 45, 60]) {
    for (const s of [1, -1]) {
      const h = Math.round(norm360(p.hdg + s * turn) / 5) * 5 % 360 || 360;
      const cost = 0.8 + turn / 20 + extra;
      if (onLoc) out.push({ cmd: { hdg: h % 360, alt: breakLvl }, text: `HDG ${pad(h)} ${levelText(breakLvl)}`, cost });
      else out.push({ cmd: { hdg: h % 360 }, text: `HDG ${pad(h)}`, cost });
    }
  }
  // speed control: routine on final (in-trail spacing), weak en route
  for (const dv of onLoc ? [-20, -40, -60] : [-40, 40]) {
    const s = clamp(Math.round((p.spd + dv) / 10) * 10, onLoc ? 140 : 160, 480);
    if (Math.abs(s - p.targetSpd) >= 15) out.push({ cmd: { spd: s }, text: `SPD ${s}`, cost: onLoc ? 1 + Math.abs(dv) / 40 : 3 });
  }
  return out;
}

/**
 * Resolution advisories for one conflict: single-aircraft clearances that keep the
 * pair apart for the whole probe horizon (with a buffer) without creating a new conflict with
 * anyone else. Already-lost pairs accept clearances that restore separation sooner.
 */
function adviseConflict(c, max = 3) {
  if (state.source !== "sim") return [];
  const opts = { buffer: ADVISE_BUFFER };
  const side = {};
  for (const p of [c.a, c.b]) {
    if (!commandable(p)) continue;
    const traffic = trafficPaths(p);
    const baseline = probeCommand(p, null, traffic, opts).losses;
    side[p.cs] = { traffic, before: new Set(baseline.map((l) => l.cs)), baseline };
  }

  /** Cost of a clearance for `p` (with `override` for the partner), or null if unacceptable. */
  const judge = (p, other, path, override) => {
    const S = side[p.cs];
    const { losses } = probeCommand(p, null, S.traffic, { ...opts, path, override });
    if (losses.some((l) => l.cs !== other.cs && !S.before.has(l.cs))) return null; // creates a new conflict
    const pair = losses.find((l) => l.cs === other.cs);
    if (!pair) return 0;
    // only acceptable when separation is already lost and this restores it sooner
    const basePair = S.baseline.find((l) => l.cs === other.cs);
    if (c.level !== "CONFLICT" || !basePair || pair.end > 90 || pair.steps >= basePair.steps) return null;
    return pair.end / 30;
  };

  const out = [];
  for (const [p, other] of [[c.a, c.b], [c.b, c.a]]) {
    if (!side[p.cs]) continue;
    for (const cand of candidateCommands(p)) {
      const extra = judge(p, other, forecast(p, cand.cmd));
      if (extra !== null) out.push({ cs: p.cs, text: cand.text, cost: cand.cost + extra + (p.emergency ? 3 : 0) });
    }
  }

  // vertical split: one climbs, the other descends (separates twice as fast)
  const [a, b] = [c.a, c.b];
  if (side[a.cs] && side[b.cs] && a.ilsState !== "LOC" && b.ilsState !== "LOC") {
    const mid = Math.round((a.alt + b.alt) / 2000) * 1000;
    for (const s of a.alt >= b.alt ? [1, -1] : [-1, 1]) {
      const la = mid + s * 1000, lb = mid - s * 1000;
      if (Math.min(la, lb) < 3000 || Math.max(la, lb) > 41000) continue;
      const pa = forecast(a, { alt: la }), pb = forecast(b, { alt: lb });
      const ea = judge(a, b, pa, new Map([[b.cs, pb]]));
      const eb = ea === null ? null : judge(b, a, pb, new Map([[a.cs, pa]]));
      if (eb === null) continue;
      out.push({ cs: a.cs, text: levelText(la), also: { cs: b.cs, text: levelText(lb) },
                 cost: 3 + Math.max(ea, eb) + (a.emergency || b.emergency ? 3 : 0) });
      break;
    }
  }

  out.sort((x, y) => x.cost - y.cost);
  // at most two suggestions per aircraft so both sides are offered
  const per = {};
  return out.filter((r) => (per[r.cs] = (per[r.cs] || 0) + 1) <= 2).slice(0, max);
}

const pairKey = (a, b) => [a.cs, b.cs].sort().join("|");
const HINT_COST = 25;

/** Training mode: advisories for a pair are revealed for a point penalty. */
function buyHint(key) {
  const rec = state.pairs.get(key);
  if (!rec || rec.hinted) return false;
  rec.hinted = true;
  addPoints(-HINT_COST);
  logEvent("HINT", "log.hint", { pair: key.replace("|", "/"), cost: HINT_COST }, key.split("|"));
  return true;
}

/* ---------- conflict detection & scoring ---------- */

function detectConflicts() {
  const list = [];
  const P = state.planes.filter((p) => !p.primary && !p.landed);
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j];
      // runway operations are separated by the tower; in live mode the Istanbul terminal
      // area (parallel approaches, stale ADS-B fixes) is left to approach control
      if (pairExempt(a, b)) continue;
      const sepH = sepFor(a, b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const dh = Math.hypot(dx, dy);
      const dv = Math.abs(b.alt - a.alt);
      if (dh > 40) continue;

      if (dh < sepH && dv < SEP_V) {
        list.push({ a, b, level: "CONFLICT", dh, dv, tcpa: 0, dcpa: dh });
        continue;
      }
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const v2 = rvx * rvx + rvy * rvy;
      const t = v2 > 0 ? clamp(-(dx * rvx + dy * rvy) / v2, 0, LOOKAHEAD) : 0;
      const dcpa = Math.hypot(dx + rvx * t, dy + rvy * t);
      const dvc = Math.abs(projectedAlt(a, t) - projectedAlt(b, t));
      if (t > 0 && dcpa < sepH && dvc < SEP_V) {
        list.push({ a, b, level: "TRAFFIC", dh, dv, tcpa: t, dcpa });
      }
    }
  }

  const rank = { NORMAL: 0, TRAFFIC: 1, CONFLICT: 2 };
  for (const p of state.planes) p.status = "NORMAL";
  for (const c of list) {
    for (const p of [c.a, c.b]) if (rank[c.level] > rank[p.status]) p.status = c.level;
  }

  // pair lifecycle → log + score
  const now = new Set();
  for (const c of list) {
    const key = pairKey(c.a, c.b);
    const pair = key.replace("|", "/");
    now.add(key);
    let rec = state.pairs.get(key);
    if (!rec) {
      rec = { commanded: false, escalated: false };
      state.pairs.set(key, rec);
      if (c.level === "TRAFFIC") {
        logEvent("TRAFFIC", "log.traffic", { pair, t: Math.round(c.tcpa), d: c.dcpa.toFixed(1) }, [c.a.cs, c.b.cs]);
      }
    }
    if (c.level === "CONFLICT" && !rec.escalated) {
      rec.escalated = true;
      state.score.violations++;
      addPoints(-150);
      logEvent("CONFLICT", "log.conflict", { pair, dh: c.dh.toFixed(1), dv: Math.round(c.dv) }, [c.a.cs, c.b.cs]);
      if (passFilter(c.a) || passFilter(c.b)) hooks.alarm();
    }
  }
  const byCs = new Map(state.planes.map((p) => [p.cs, p]));
  for (const [key, rec] of state.pairs) {
    if (now.has(key)) continue;
    const [ca, cb] = key.split("|");
    const a = byCs.get(ca), b = byCs.get(cb);
    const pair = key.replace("|", "/");
    // one aircraft left the sector or landed: neither resolved nor restored
    if (!a || !b || a.landed || b.landed) { state.pairs.delete(key); continue; }
    if (rec.escalated) {
      logEvent("CLEAR", "log.clear", { pair }, [ca, cb]);
      state.pairs.delete(key);
    } else if (!rec.commanded) {
      state.pairs.delete(key);
    } else {
      // No longer predicted. Credit the clearance only once separation is assured:
      // vertically separated, or past the closest point (diverging).
      const dx = b.x - a.x, dy = b.y - a.y;
      const diverging = dx * (b.vx - a.vx) + dy * (b.vy - a.vy) > 0;
      if (Math.abs(a.alt - b.alt) >= SEP_V || diverging) {
        state.score.resolved++;
        addPoints(100);
        logEvent("RESOLVED", state.training ? "log.resolvedPts" : "log.resolved", { pair, pts: 100 }, [ca, cb]);
        state.pairs.delete(key);
      }
    }
  }

  list.sort((x, y) => rank[y.level] - rank[x.level] || x.tcpa - y.tcpa);
  state.conflicts = list;
}

/* ---------- sweep, phosphor & clutter ---------- */

function paint(p) {
  if (p.disp) {
    p.trail.unshift({ x: p.disp.x, y: p.disp.y });
    if (p.trail.length > 6) p.trail.pop();
  }
  p.disp = { x: p.x, y: p.y, alt: p.alt, vs: p.vs, gs: p.gs, trk: p.trk, targetAlt: p.targetAlt };
  p.paintAngle = bearingOf(p.x, p.y);
}

function regenClutter() {
  const pts = [];
  for (let i = 0; i < 18; i++) pts.push(polar(rand(0, 360), rand(0.3, 3.5)));
  for (let i = 0; i < 5; i++) pts.push(polar(rand(0, 360), rand(3, WORLD_RADIUS)));
  state.clutter = pts.map((p) => ({ ...p, b: bearingOf(p.x, p.y) }));
}

function advanceSweep(dtReal, paintTargets = true) {
  const prev = state.sweep;
  const delta = state.rpm * 6 * dtReal;
  if (paintTargets) {
    for (const p of state.planes) {
      if (delta >= 360 || norm360(bearingOf(p.x, p.y) - prev) < delta) paint(p);
    }
  }
  if (prev + delta >= 360) {
    hooks.sweep();
    // ground clutter is simulated; live data gets none
    if (state.source === "sim") regenClutter();
    else state.clutter = [];
  }
  state.sweep = norm360(prev + delta);
}

/* ---------- lifecycle ---------- */

function forgetPlane(p) {
  usedCallsigns.delete(p.cs);
  if (state.selectedCs === p.cs) state.selectedCs = null;
  if (state.ruler.a === p.cs || state.ruler.b === p.cs) state.ruler.a = state.ruler.b = null;
}

function replenish() {
  state.planes = state.planes.filter((p) => {
    if (p.landed) {
      state.score.landed++;
      addPoints(50);
      logEvent("LANDED", "log.landed", { cs: p.cs, rwy: AIRPORT.rwy }, [p.cs]);
      forgetPlane(p);
      return false;
    }
    if (!p.live && Math.hypot(p.x, p.y) > WORLD_RADIUS) {
      forgetPlane(p);
      return false;
    }
    return true;
  });

  if (state.source !== "sim" || !state.autoSpawn) return;
  if (!state.planes.some((p) => p.primary)) state.planes.push(spawnPlane("primary"));
  while (state.planes.length < PLANE_COUNT) state.planes.push(spawnPlane(pickKind()));
}

function randomEmergency() {
  if (state.simTime < state.nextEmergency) return;
  state.nextEmergency = state.simTime + rand(240, 480);
  if (state.planes.some((p) => p.emergency) || Math.random() > 0.5) return;
  const cands = state.planes.filter((p) => !p.primary && !p.live && Math.hypot(p.x, p.y) < 25);
  if (cands.length) setEmergency(pick(cands), pick(["7700", "7700", "7600", "7500"]));
}

function maybeEngineer() {
  if (state.simTime < state.nextEngineer) return;
  state.nextEngineer = state.simTime + (state.training ? 45 : 75);
  const hasConflict = state.conflicts.some((c) => c.level === "CONFLICT");
  const traffic = state.conflicts.filter((c) => c.level === "TRAFFIC").length;
  if (!hasConflict && traffic < (state.training ? 2 : 1)) engineerConflict();
}

/* ---------- recording & replay ---------- */

function recordSnapshot() {
  if (state.simTime < state.nextSnapshot) return;
  state.nextSnapshot = state.simTime + SNAPSHOT_EVERY;
  state.history.push({
    t: state.simTime,
    planes: state.planes.map((p) => ({
      cs: p.cs, x: p.x, y: p.y, alt: p.alt, vs: p.vs, gs: p.gs, trk: p.trk, hdg: p.hdg, spd: p.spd,
      targetAlt: p.targetAlt, status: p.status, emergency: p.emergency, areaAlert: p.areaAlert,
      primary: p.primary, live: p.live, type: p.type, squawk: p.squawk, origin: p.origin, dest: p.dest,
    })),
    conflicts: state.conflicts.map((c) => ({
      a: c.a.cs, b: c.b.cs, level: c.level, dh: c.dh, dv: c.dv, tcpa: c.tcpa, dcpa: c.dcpa,
    })),
  });
  if (state.history.length > REPLAY_MAX) state.history.shift();
}

function snapIndexAt(t) {
  const H = state.history;
  let lo = 0, hi = H.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (H[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function replayView() {
  const H = state.history;
  const i = snapIndexAt(state.replay.t);
  const s = H[i];
  const planes = s.planes.map((sp) => {
    const trail = [];
    for (let k = 1; k <= 6; k++) {
      const h = H[i - k * 4];
      if (!h) break;
      const q = h.planes.find((o) => o.cs === sp.cs);
      if (q) trail.push({ x: q.x, y: q.y });
    }
    return { ...sp, disp: sp, trail, replay: true };
  });
  const byCs = new Map(planes.map((p) => [p.cs, p]));
  const conflicts = s.conflicts
    .map((c) => ({ ...c, a: byCs.get(c.a), b: byCs.get(c.b) }))
    .filter((c) => c.a && c.b);
  return { planes, conflicts, t: s.t };
}

function currentView() {
  if (state.replay.active && state.history.length) return replayView();
  return { planes: state.planes, conflicts: state.conflicts, t: state.simTime };
}

/* ---------- reset & scenarios ---------- */

function resetSim() {
  state.planes = [];
  usedCallsigns.clear();
  primaryCounter = 0;
  state.conflicts = [];
  state.pairs.clear();
  state.log = [];
  state.logDirty = true;
  state.history = [];
  state.nextSnapshot = 0;
  state.simTime = 0;
  state.nextEngineer = 75;
  state.nextEmergency = rand(240, 420);
  state.selectedCs = null;
  state.preview = null;
  state.vectorDrag = null;
  state.ruler.a = state.ruler.b = null;
  state.replay.active = false;
  state.score = emptyScore();
  state.clutter = [];
  state.autoSpawn = true;
  hooks.reset();
}

function initRandomTraffic() {
  resetSim();
  state.scenarioName = "@scn.random";
  state.wind = { dir: randInt(0, 359), spd: randInt(10, 35) };
  state.planes.push(...makeConflictPair(60));
  state.planes.push(spawnPlane("primary", true));
  while (state.planes.length < PLANE_COUNT) state.planes.push(spawnPlane(pickKind(), true));
  state.wx = makeWeather(3);
  state.planes.forEach(paint);
  logEvent("SYSTEM", "log.scnLoaded", { name: state.scenarioName, n: state.planes.length });
}

function loadScenario(sc) {
  if (!sc || typeof sc !== "object" || !Array.isArray(sc.planes)) {
    throw new Error(i18n("err.badScenario"));
  }
  resetSim();
  // a user-supplied name must never be read as an i18n key
  state.scenarioName = sc.name ? String(sc.name).replace(/^@+/, "").slice(0, 60) : "@scn.custom";
  if (sc.wind) state.wind = { dir: norm360(num(sc.wind.dir, 240)), spd: clamp(num(sc.wind.spd, 20), 0, 80) };
  state.autoSpawn = sc.autoSpawn !== false;
  if (typeof sc.training === "boolean") state.training = sc.training;
  state.wx = Array.isArray(sc.weather)
    ? sc.weather.map((w) => makeCell(num(w.x), num(w.y), clamp(num(w.r, 3), 1, 8)))
    : makeWeather(2);

  const skipped = [];
  for (const d of sc.planes.slice(0, 40)) {
    let x = num(d.x), y = num(d.y);
    const r = Math.hypot(x, y);
    if (r > WORLD_RADIUS - 0.5) { x *= (WORLD_RADIUS - 0.5) / r; y *= (WORLD_RADIUS - 0.5) / r; }
    const route = Array.isArray(d.route) ? d.route.map((s) => String(s).toUpperCase()) : [];
    route.filter((f) => !FIXES[f]).forEach((f) => skipped.push(f));
    const validRoute = route.filter((f) => FIXES[f]);
    const alt = d.fl != null ? clamp(num(d.fl) * 100, 0, 45000) : undefined;
    const toFirst = validRoute.length ? FIXES[validRoute[0]] : null;
    const hdg = d.hdg != null ? norm360(num(d.hdg))
      : toFirst ? bearingOf(toFirst.x - x, toFirst.y - y) : bearingOf(-x, -y);
    const arrival = !!d.arrival;
    const departureExit = typeof d.departureExit === "string" && FIXES[d.departureExit.toUpperCase()]
      ? d.departureExit.toUpperCase() : null;
    const assignedHdg = d.assignedHdg != null ? norm360(num(d.assignedHdg)) : null;
    const p = makePlane({
      cs: d.cs ? String(d.cs).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8) || undefined : undefined,
      type: d.type ? String(d.type).slice(0, 4).toUpperCase() : undefined,
      x, y, hdg,
      assignedHdg: assignedHdg ?? (validRoute.length || arrival || departureExit ? null : hdg),
      departureExit,
      alt,
      targetAlt: d.targetFl != null ? clamp(num(d.targetFl) * 100, 0, 45000) : alt,
      spd: d.spd != null ? clamp(num(d.spd), 60, 550) : undefined,
      route: arrival && !validRoute.length ? ["KOPRU"] : validRoute,
      arrival,
      ilsCleared: arrival && !state.training,
      dest: arrival ? AIRPORT.icao : d.dest,
      origin: d.origin,
      primary: !!d.primary,
      squawk: d.squawk ? String(d.squawk).replace(/\D/g, "").slice(0, 4) || undefined : undefined,
      lockUntil: Infinity,
    });
    if (Array.isArray(d.resume)) {
      const back = d.resume.map((f) => String(f).toUpperCase()).filter((f) => FIXES[f]);
      if (back.length) p.resume = { route: back, ils: arrival };
    }
    if (d.controlled) p.controlled = true;
    state.planes.push(p);
  }
  state.planes.forEach(paint);
  logEvent("SYSTEM", "log.scnLoaded", { name: state.scenarioName, n: state.planes.length });
  if (skipped.length) logEvent("SYSTEM", "log.scnSkipped", { fixes: [...new Set(skipped)].join(", ") });
}

function exportScenario() {
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    name: i18n("scn.savedName", { name: state.scenarioName, t: fmtClock(state.simTime) }),
    wind: { dir: Math.round(state.wind.dir), spd: Math.round(state.wind.spd) },
    training: state.training,
    autoSpawn: state.autoSpawn,
    weather: state.wx.map((c) => ({ x: r1(c.x), y: r1(c.y), r: r1(c.r) })),
    planes: state.planes.filter((p) => !p.live).map((p) => {
      const o = {
        cs: p.cs, type: p.type, x: r1(p.x), y: r1(p.y), hdg: Math.round(p.hdg),
        fl: Math.round(p.alt / 100), targetFl: Math.round(p.targetAlt / 100), spd: Math.round(p.spd),
        origin: p.origin, dest: p.dest,
      };
      if (p.route.length) o.route = [...p.route];
      if (p.assignedHdg != null && !p.route.length) o.assignedHdg = Math.round(p.assignedHdg);
      if (p.departureExit) o.departureExit = p.departureExit;
      if (p.resume?.route.length) o.resume = [...p.resume.route];
      if (p.controlled) o.controlled = true;
      if (p.arrival) o.arrival = true;
      if (p.primary) o.primary = true;
      if (!p.primary) o.squawk = p.squawk;
      return o;
    }),
  };
}

/* Built-in scenarios (positions in NM from LTFM, x = east, y = north) */
const BUILTIN_SCENARIOS = {
  crossing: {
    name: "@scn.crossing",
    wind: { dir: 270, spd: 15 },
    autoSpawn: true,
    weather: [{ x: -16, y: 16, r: 3 }],
    planes: [
      { cs: "THY101", type: "A321", x: -5.9, y: 7.1, fl: 330, spd: 400, route: ["TUZLA", "MENEK"] },
      { cs: "PGT202", type: "A320", x: -1.4, y: 18.5, fl: 330, spd: 400, route: ["TUZLA", "RAMOS", "VEDAT"] },
      { cs: "DLH303", type: "A359", x: -4, y: -8.6, fl: 290, spd: 440, route: ["RAMOS", "SEDEF"] },
      { cs: "BAW404", type: "B789", x: 13, y: -21.7, fl: 290, spd: 440, route: ["RAMOS", "TUZLA", "NIKEL"] },
      { cs: "KLM505", type: "B738", x: -20, y: -12, fl: 140, spd: 300, arrival: true },
      { cs: "AFR606", type: "A333", x: 20, y: 6, fl: 370, spd: 450, hdg: 250 },
      { primary: true, x: -14, y: -19, fl: 35, spd: 110, hdg: 90 },
    ],
  },
  approach: {
    name: "@scn.approach",
    wind: { dir: 330, spd: 20 },
    autoSpawn: true,
    weather: [{ x: 6, y: -9, r: 2.5 }],
    planes: [
      { cs: "THY711", type: "A321", x: 3, y: -22, fl: 110, spd: 280, arrival: true },
      { cs: "PGT712", type: "A320", x: -12, y: -16, fl: 120, spd: 290, arrival: true },
      { cs: "DLH713", type: "A320", x: 16, y: -14, fl: 130, spd: 300, arrival: true },
      { cs: "KLM714", type: "B738", x: -20, y: -4, fl: 140, spd: 300, arrival: true },
      { cs: "UAL715", type: "B77W", x: 20, y: -24, fl: 150, spd: 310, arrival: true },
      { cs: "AFR716", type: "A333", x: 0.5, y: 3, fl: 30, targetFl: 180, spd: 220, hdg: 350, route: ["NIKEL"] },
    ],
  },
  emergency: {
    name: "@scn.emergency",
    wind: { dir: 200, spd: 30 },
    autoSpawn: true,
    weather: [{ x: -4, y: -10, r: 3 }, { x: 15, y: 5, r: 4 }],
    planes: [
      { cs: "THY990", type: "B77W", x: 15, y: 14, fl: 330, spd: 420, squawk: "7700" },
      { cs: "PGT991", type: "A320", x: -18, y: 10, fl: 240, spd: 380, hdg: 120, squawk: "7600" },
      { cs: "DLH992", type: "A321", x: 4, y: 20, fl: 330, spd: 410, route: ["TUZLA", "RAMOS", "VEDAT"] },
      { cs: "BAW993", type: "A359", x: -20, y: -12, fl: 160, spd: 320, arrival: true },
      { cs: "KLM994", type: "B738", x: 22, y: -6, fl: 280, spd: 400, route: ["RAMOS", "PELIT", "OLMAK"] },
    ],
  },
};
