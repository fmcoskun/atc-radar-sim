"use strict";
/* ==========================================================================
   render.js — canvas drawing (scope, map, weather, traffic, labels, ruler)
   ========================================================================== */

const canvas = document.getElementById("radar");
const ctx = canvas.getContext("2d");
const geo = { size: 0, dpr: 1, c: 0, R: 0, scale: 1 };

/** cs → { manual, dx, dy, slot } — data-block placement */
const labelState = new Map();
let labelRects = []; // [{cs, x, y, w, h}] for hit-testing (drag)

const FONT = "11px 'Courier New', monospace";

/* Colours come from the CSS custom properties in style.css (single source of truth),
   as "r,g,b" strings for rgba(). Fallbacks keep headless tests working. */
function cssRgb(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
    if (m) return m.slice(1).map((h) => parseInt(h, 16)).join(",");
  } catch { /* no CSSOM */ }
  return fallback;
}
const G = cssRgb("--green", "0,255,100");
const RED = cssRgb("--red", "255,69,69");
const AMBER = cssRgb("--amber", "255,190,40");
const MAGENTA = cssRgb("--magenta", "255,80,255");
const BLUE = cssRgb("--wx", "40,150,255");
const AREA_COL = cssRgb("--area", "255,110,90");
const PREVIEW = cssRgb("--preview", "90,220,255");

hooks.reset = () => labelState.clear();
const LINE_H = 12;

function resize() {
  const rect = canvas.getBoundingClientRect();
  geo.dpr = window.devicePixelRatio || 1;
  geo.size = rect.width;
  canvas.width = Math.round(rect.width * geo.dpr);
  canvas.height = Math.round(rect.height * geo.dpr);
  updateGeometry();
}

function updateGeometry() {
  geo.c = geo.size / 2;
  geo.R = (geo.size / 2) * 0.9;
  geo.scale = geo.R / state.range;
}

const toScreen = (x, y) => [geo.c + x * geo.scale, geo.c - y * geo.scale];
const toWorld = (px, py) => ({ x: (px - geo.c) / geo.scale, y: (geo.c - py) / geo.scale });

function fmtNm(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function visible(p) {
  return p.disp && Math.hypot(p.disp.x, p.disp.y) <= state.range * 1.08;
}

function planeColor(p, now) {
  const blink = Math.floor(now / 250) % 2;
  if (p.emergency) return blink ? MAGENTA : "255,190,255";
  if (p.status === "CONFLICT") return blink ? RED : "255,160,160";
  if (p.areaAlert) return AREA_COL;
  if (p.status === "TRAFFIC") return AMBER;
  return G;
}

/* ---------- main ---------- */

function draw(now) {
  const { size, c } = geo;
  if (!size) return;
  const view = state.view;

  ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, size / 2, 0, Math.PI * 2);
  ctx.clip();

  const bg = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  bg.addColorStop(0, "#062006");
  bg.addColorStop(1, "#020a02");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  if (state.layers.wx) drawWeather();
  // the restricted areas are fictional, so they are not drawn over real traffic
  if (state.layers.areas && state.source === "sim") drawAreas();
  drawScope();
  if (state.layers.map) drawMap();
  drawSweep();
  if (state.layers.clutter && !state.replay.active) drawClutter();
  drawTraffic(view, now);
  if (!state.replay.active) drawPreview();
  drawRuler(view);

  if (state.replay.active) {
    ctx.font = "bold 13px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = Math.floor(now / 600) % 2 ? `rgb(${AMBER})` : rgba(AMBER, 0.6);
    ctx.fillText(`◼ REPLAY  T+${fmtClock(view.t)}`, c, size * 0.14);
  }
  ctx.restore();
}

/* ---------- static layers ---------- */

function drawScope() {
  const { c, R } = geo;
  ctx.font = FONT;
  ctx.lineWidth = 1;

  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = rgba(G, 0.3);
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(c, c, (R * k) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = rgba(G, 0.1);
  ctx.beginPath();
  ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
  ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
  ctx.stroke();

  ctx.fillStyle = rgba(G, 0.6);
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  for (let k = 1; k <= 3; k++) {
    ctx.fillText(`${fmtNm((state.range * k) / 3)} NM`, c + (R * k) / 3 - 4, c - 3);
  }

  ctx.strokeStyle = rgba(G, 0.45);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelR = R + (geo.size / 2 - R) / 2;
  for (let d = 0; d < 360; d += 5) {
    const a = deg2rad(d - 90);
    const len = d % 30 === 0 ? 7 : d % 10 === 0 ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
    ctx.lineTo(c + Math.cos(a) * (R + len), c + Math.sin(a) * (R + len));
    ctx.stroke();
    if (d % 30 === 0 && geo.size > 320) {
      ctx.fillText(pad(d), c + Math.cos(a) * (labelR + 3), c + Math.sin(a) * (labelR + 3));
    }
  }
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(G, 0.5);
  ctx.stroke();
}

function drawMap() {
  ctx.font = "9px 'Courier New', monospace";
  ctx.lineWidth = 1;

  // Airways
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = rgba(G, 0.16);
  ctx.fillStyle = rgba(G, 0.3);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const aw of AIRWAYS) {
    ctx.beginPath();
    aw.fixes.forEach((f, i) => {
      const [x, y] = toScreen(FIXES[f].x, FIXES[f].y);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    const A = FIXES[aw.fixes[0]], B = FIXES[aw.fixes[1]];
    const [mx, my] = toScreen((A.x + B.x) / 2, (A.y + B.y) / 2);
    ctx.fillText(aw.name, mx, my - 7);
  }
  ctx.setLineDash([]);

  // ILS final approach course
  const [tx, ty] = toScreen(THR.x, THR.y);
  const ilsEnd = (off) => {
    const p = polar(APP_BRG + off, ILS_LEN);
    return toScreen(THR.x + p.x, THR.y + p.y);
  };
  const [ex, ey] = ilsEnd(0);
  ctx.strokeStyle = rgba(G, 0.22);
  ctx.beginPath();
  for (const off of [-3, 3]) {
    const [x, y] = ilsEnd(off);
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = rgba(G, 0.4);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  // range ticks every 5 NM on the final
  for (let d = 5; d <= ILS_LEN; d += 5) {
    const p = polar(APP_BRG, d);
    const [x, y] = toScreen(THR.x + p.x, THR.y + p.y);
    const n = deg2rad(APP_BRG + 90);
    ctx.beginPath();
    ctx.moveTo(x - Math.sin(n) * 4, y + Math.cos(n) * 4);
    ctx.lineTo(x + Math.sin(n) * 4, y - Math.cos(n) * 4);
    ctx.stroke();
  }

  // Runway + airport label
  const [rx, ry] = toScreen(RWY_END.x, RWY_END.y);
  ctx.strokeStyle = rgba(G, 0.85);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = rgba(G, 0.55);
  ctx.textAlign = "left";
  ctx.fillText(`${AIRPORT.icao} ${AIRPORT.rwy}`, tx + 6, ty + 2);

  // Fixes
  ctx.strokeStyle = rgba(G, 0.45);
  ctx.fillStyle = rgba(G, 0.4);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const [name, f] of Object.entries(FIXES)) {
    const [x, y] = toScreen(f.x, f.y);
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 3.5, y + 2.5);
    ctx.lineTo(x - 3.5, y + 2.5);
    ctx.closePath();
    ctx.stroke();
    ctx.fillText(name, x, y + 5);
  }
}

let hatchPattern = null;
function getHatch() {
  if (hatchPattern) return hatchPattern;
  const pc = document.createElement("canvas");
  pc.width = pc.height = 8;
  const g = pc.getContext("2d");
  g.strokeStyle = rgba(AREA_COL, 0.35);
  g.beginPath();
  g.moveTo(0, 8);
  g.lineTo(8, 0);
  g.stroke();
  hatchPattern = ctx.createPattern(pc, "repeat");
  return hatchPattern;
}

function drawAreas() {
  ctx.font = "10px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const a of AREAS) {
    ctx.beginPath();
    let cx, cy;
    if (a.type === "circle") {
      [cx, cy] = toScreen(a.x, a.y);
      ctx.arc(cx, cy, a.r * geo.scale, 0, Math.PI * 2);
    } else {
      a.pts.forEach(([x, y], i) => {
        const [sx, sy] = toScreen(x, y);
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      ctx.closePath();
      const mx = a.pts.reduce((s, p) => s + p[0], 0) / a.pts.length;
      const my = a.pts.reduce((s, p) => s + p[1], 0) / a.pts.length;
      [cx, cy] = toScreen(mx, my);
    }
    ctx.fillStyle = getHatch();
    ctx.fill();
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = rgba(AREA_COL, 0.6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(AREA_COL, 0.8);
    ctx.fillText(a.name, cx, cy - 6);
    ctx.fillText(`${fmtAlt(a.lo)}-${fmtAlt(a.hi)}`, cx, cy + 6);
  }
}

function drawWeather() {
  for (const c of state.wx) {
    for (const b of c.blobs) {
      const [x, y] = toScreen(c.x + b.dx, c.y + b.dy);
      const r = b.r * geo.scale;
      if (r < 1) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(BLUE, 0.32 * b.i));
      g.addColorStop(0.6, rgba(BLUE, 0.16 * b.i));
      g.addColorStop(1, rgba(BLUE, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSweep() {
  const { c, R } = geo;
  const lead = deg2rad(state.sweep - 90);
  if (ctx.createConicGradient) {
    const g = ctx.createConicGradient(lead, c, c);
    g.addColorStop(0, rgba(G, 0));
    g.addColorStop(0.72, rgba(G, 0));
    g.addColorStop(0.96, rgba(G, 0.14));
    g.addColorStop(1, rgba(G, 0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.strokeStyle = rgba(G, 0.95);
  ctx.lineWidth = 2;
  ctx.shadowColor = "#00ff66";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c + Math.cos(lead) * R, c + Math.sin(lead) * R);
  ctx.stroke();
  ctx.restore();
}

function drawClutter() {
  for (const p of state.clutter) {
    const age = norm360(state.sweep - p.b) / 360;
    const a = 0.55 * Math.pow(1 - age, 3);
    if (a < 0.02 || Math.hypot(p.x, p.y) > state.range) continue;
    const [x, y] = toScreen(p.x, p.y);
    ctx.fillStyle = rgba(G, a);
    ctx.fillRect(x - 1, y - 1, 2 + Math.random(), 2);
  }
}

/* ---------- traffic ---------- */

function labelLines(p) {
  const d = p.disp;
  let l2 = `FL${pad(d.alt / 100)}${vsArrow(d.vs)}`;
  if (Math.abs(d.targetAlt - d.alt) >= 100) {
    // the arrow separates current and cleared level even before V/S builds up
    if (!vsArrow(d.vs)) l2 += d.targetAlt > d.alt ? "↗" : "↘";
    l2 += pad(d.targetAlt / 100);
  }
  // third line: ground speed + the active clearance (assigned heading or direct-to fix)
  let l3 = `${pad(d.gs)}KT`;
  if (p.controlled && !p.replay) {
    if (p.assignedHdg != null && !p.route.length) l3 += ` H${pad(p.assignedHdg || 360)}`;
    else if (p.route.length && !p.ilsCleared) l3 += ` →${p.route[0]}`;
  }
  const lines = [p.cs + (p.emergency ? ` ${EMERGENCY[p.emergency]}` : ""), l2, l3];
  if (p.areaAlert) lines.push(`AREA ${p.areaAlert}`);
  return lines;
}

function rectOverlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Choose a data-block position per target, avoiding other labels and blips. */
function placeLabels(planes) {
  ctx.font = FONT;
  const placed = [];
  const blips = planes.map((p) => toScreen(p.disp.x, p.disp.y));
  const out = new Map();
  const order = planes
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (labelState.get(b.p.cs)?.manual ? 1 : 0) - (labelState.get(a.p.cs)?.manual ? 1 : 0));

  for (const { p, i } of order) {
    const lines = labelLines(p);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const h = lines.length * LINE_H;
    const [sx, sy] = blips[i];
    let st = labelState.get(p.cs);
    if (!st) labelState.set(p.cs, (st = { manual: false, dx: 10, dy: 6, slot: 0 }));

    let rect;
    if (st.manual) {
      rect = { x: sx + st.dx, y: sy + st.dy, w, h };
    } else {
      const cands = [[10, 6], [10, -h - 6], [-w - 10, 6], [-w - 10, -h - 6]];
      let best = 0, bestScore = Infinity;
      cands.forEach(([dx, dy], k) => {
        const r = { x: sx + dx, y: sy + dy, w, h };
        let s = k === st.slot ? 0 : 40;
        for (const q of placed) s += rectOverlap(r, q);
        blips.forEach(([bx, by], j) => {
          if (j !== i && bx > r.x - 4 && bx < r.x + w + 4 && by > r.y - 4 && by < r.y + h + 4) s += 300;
        });
        const cx = r.x + w / 2 - geo.c, cy = r.y + h / 2 - geo.c;
        if (Math.hypot(cx, cy) > geo.R) s += 500;
        if (s < bestScore) { bestScore = s; best = k; }
      });
      st.slot = best;
      st.dx = cands[best][0];
      st.dy = cands[best][1];
      rect = { x: sx + st.dx, y: sy + st.dy, w, h };
    }
    placed.push(rect);
    out.set(p.cs, { rect, lines, manual: st.manual });
  }
  return out;
}

function drawTraffic(view, now) {
  const ppm = geo.scale;
  const planes = view.planes.filter((p) => visible(p) && passFilter(p));
  const shown = new Set(planes.map((p) => p.cs));
  ctx.font = FONT;
  ctx.lineWidth = 1;

  // conflict links
  for (const cf of view.conflicts) {
    if (!shown.has(cf.a.cs) || !shown.has(cf.b.cs)) continue;
    const [x1, y1] = toScreen(cf.a.disp.x, cf.a.disp.y);
    const [x2, y2] = toScreen(cf.b.disp.x, cf.b.disp.y);
    const col = cf.level === "CONFLICT" ? RED : AMBER;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = rgba(col, 0.7);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(col, 0.9);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const txt = cf.level === "CONFLICT" ? `${cf.dh.toFixed(1)}NM ${Math.round(cf.dv)}FT` : `CPA ${Math.round(cf.tcpa)}s`;
    ctx.fillText(txt, (x1 + x2) / 2, (y1 + y2) / 2 + 4);
  }

  const labeled = planes.filter((p) => !p.primary);
  const labels = placeLabels(labeled);
  labelRects = [];

  for (const p of planes) {
    const d = p.disp;
    const [sx, sy] = toScreen(d.x, d.y);
    const age = p.replay ? 0.1 : norm360(state.sweep - p.paintAngle) / 360;
    const glow = (1 - age) * (1 - age);
    const col = p.primary ? G : planeColor(p, now);

    // phosphor history
    p.trail.forEach((t, i) => {
      const [tx, ty] = toScreen(t.x, t.y);
      ctx.fillStyle = rgba(col, 0.45 * (1 - i / p.trail.length));
      ctx.fillRect(tx - 1, ty - 1, 2, 2);
    });

    if (p.primary) {
      // primary-only return: no transponder, no data block
      ctx.strokeStyle = rgba(G, 0.3 + 0.7 * glow);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy);
      ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4);
      ctx.stroke();
      ctx.lineWidth = 1;
    } else {
      // speed vector: 1 minute along the ground track
      const tr = deg2rad(d.trk);
      const vlen = (d.gs / 60) * ppm;
      ctx.strokeStyle = rgba(col, 0.65);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.sin(tr) * vlen, sy - Math.cos(tr) * vlen);
      ctx.stroke();

      if (p.cs === state.selectedCs && state.projection) drawProjection(d, sx, sy, col);

      ctx.save();
      ctx.fillStyle = rgba(col, 0.35 + 0.65 * glow);
      ctx.shadowColor = `rgb(${col})`;
      ctx.shadowBlur = 4 + 12 * glow;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // data block
      const lb = labels.get(p.cs);
      if (lb) {
        const { rect, lines } = lb;
        const nx = clamp(sx, rect.x, rect.x + rect.w);
        const ny = clamp(sy, rect.y, rect.y + rect.h);
        if (Math.hypot(nx - sx, ny - sy) > 14) {
          ctx.strokeStyle = rgba(col, 0.4);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(nx, ny);
          ctx.stroke();
        }
        ctx.fillStyle = rgba(col, 0.55 + 0.45 * glow);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        lines.forEach((l, i) => ctx.fillText(l, rect.x, rect.y + i * LINE_H));
        labelRects.push({ cs: p.cs, ...rect });
      }
    }

    if (p.cs === state.selectedCs) {
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.strokeRect(sx - 9, sy - 9, 18, 18);
    }
    if (p.cs === state.ruler.a || p.cs === state.ruler.b) {
      ctx.strokeStyle = rgba(AMBER, 0.95);
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawProjection(d, sx, sy, col) {
  const tr = deg2rad(d.trk);
  const nmPerMin = d.gs / 60;
  const ux = Math.sin(tr), uy = -Math.cos(tr);
  const end = 5 * nmPerMin * geo.scale;

  ctx.setLineDash([2, 5]);
  ctx.strokeStyle = rgba(col, 0.6);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + ux * end, sy + uy * end);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const m of [1, 3, 5]) {
    const L = m * nmPerMin * geo.scale;
    const px = sx + ux * L, py = sy + uy * L;
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(col, 0.85);
    ctx.fillText(`${m}′`, px + 5, py - 14);
  }
}

/** Dashed forecast path with a tick + flight level every minute. */
function drawForecast(path, col) {
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = rgba(col, 0.85);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  path.forEach((pt, i) => {
    const [x, y] = toScreen(pt.x, pt.y);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;

  ctx.font = FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const perMin = 60 / PROBE_DT;
  for (let i = perMin; i < path.length; i += perMin) {
    const [x, y] = toScreen(path[i].x, path[i].y);
    ctx.fillStyle = rgba(col, 0.9);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(`${i / perMin}′ ${pad(path[i].alt / 100)}`, x + 5, y - 2);
  }
}

/** Clearance preview: forecast path, minute ticks, first predicted loss of separation. */
function drawPreview() {
  const vd = state.vectorDrag;
  if (vd && vd.moved && state.mouse) {
    const p = state.planes.find((q) => q.cs === vd.cs);
    if (p && p.disp) {
      const [sx, sy] = toScreen(p.disp.x, p.disp.y);
      ctx.strokeStyle = rgba(PREVIEW, 0.9);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(state.mouse.x, state.mouse.y);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.font = "bold 12px 'Courier New', monospace";
      ctx.fillStyle = `rgb(${PREVIEW})`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`HDG ${pad(vd.hdg || 360)}`, state.mouse.x + 10, state.mouse.y - 6);
    }
  }

  const pv = state.preview;
  if (!pv) return;
  const bad = pv.losses[0];
  const col = bad ? AMBER : PREVIEW;
  for (const e of pv.extra || []) drawForecast(e.path, PREVIEW);
  drawForecast(pv.path, col);

  if (bad) {
    const P = pv.path[bad.i];
    const [x, y] = toScreen(P.x, P.y);
    const [ox, oy] = toScreen(bad.at.x, bad.at.y);
    ctx.strokeStyle = `rgb(${RED})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6);
    ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = rgba(RED, 0.8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ox, oy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgb(${RED})`;
    ctx.textBaseline = "top";
    ctx.fillText(`${bad.cs} ${fmtMinSec(bad.t)}`, x + 8, y + 4);
  }
}

function drawRuler(view) {
  const r = state.ruler;
  if (!r.active || !r.a) return;
  const A = view.planes.find((p) => p.cs === r.a);
  if (!A || !A.disp) return;
  const B = r.b ? view.planes.find((p) => p.cs === r.b) : null;

  const [x1, y1] = toScreen(A.disp.x, A.disp.y);
  let x2, y2, label;
  if (B && B.disp) {
    [x2, y2] = toScreen(B.disp.x, B.disp.y);
    const dist = Math.hypot(B.disp.x - A.disp.x, B.disp.y - A.disp.y);
    const brg = bearingOf(B.disp.x - A.disp.x, B.disp.y - A.disp.y);
    const dfl = A.primary || B.primary ? "---" : pad(Math.abs(B.disp.alt - A.disp.alt) / 100);
    label = `${dist.toFixed(1)} NM | ΔFL ${dfl} | ${pad(brg)}°`;
  } else if (state.mouse) {
    x2 = state.mouse.x;
    y2 = state.mouse.y;
    const w = toWorld(x2, y2);
    label = `${Math.hypot(w.x - A.disp.x, w.y - A.disp.y).toFixed(1)} NM | ${pad(bearingOf(w.x - A.disp.x, w.y - A.disp.y))}°`;
  } else {
    return;
  }

  ctx.strokeStyle = rgba(AMBER, 0.95);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.lineWidth = 1;

  ctx.font = "12px 'Courier New', monospace";
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const w = ctx.measureText(label).width + 12;
  ctx.fillStyle = "rgba(10,10,0,0.85)";
  ctx.fillRect(mx - w / 2, my - 10, w, 20);
  ctx.strokeStyle = rgba(AMBER, 0.8);
  ctx.strokeRect(mx - w / 2, my - 10, w, 20);
  ctx.fillStyle = `rgb(${AMBER})`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, mx, my + 1);
}
