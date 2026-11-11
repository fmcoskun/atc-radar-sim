"use strict";
/* ==========================================================================
   ui.js — panels, controls, interaction, sound, live data, main loop
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const el = {
  utc: $("utc"), mode: $("mode"), src: $("src"), targets: $("targets"), wind: $("wind"),
  arrdep: $("arrdep"), latency: $("latency"), sys: $("sys"),
  scoreItem: $("score-item"), score: $("score"), scoreDetail: $("score-detail"),
  rows: $("target-rows"), log: $("log"), logCsv: $("log-csv"),
  detail: $("detail"), proj: $("proj-toggle"), conflicts: $("conflicts"),
  cmdPanel: $("cmd-panel"), cmdForm: $("cmd-form"), cmdHdg: $("cmd-hdg"), cmdFl: $("cmd-fl"),
  cmdSpd: $("cmd-spd"), cmdDct: $("cmd-dct"), cmdIls: $("cmd-ils"), cmdRes: $("cmd-res"),
  cmdLine: $("cmd-line"), cmdMsg: $("cmd-msg"), cmdProbe: $("cmd-probe"), cmdNav: $("cmd-nav"),
  simtime: $("simtime"), hint: $("hint"), play: $("play"), ruler: $("ruler"), sound: $("sound"),
  rpm: $("rpm"), rpmVal: $("rpm-val"), flMin: $("fl-min"), flMax: $("fl-max"),
  training: $("training"), source: $("source"),
  scenario: $("scenario"), scnReload: $("scn-reload"), scnLoad: $("scn-load"), scnSave: $("scn-save"), scnFile: $("scn-file"),
  liveBtn: $("live-btn"), timeline: $("timeline"), timelineLabel: $("timeline-label"),
  lang: $("lang"), latencyItem: $("latency-item"), scnFileOpt: $("scn-file-opt"),
};

const hintText = () => i18n(state.ruler.active ? "hint.ruler" : "hint.default");
const onOff = (on) => i18n(on ? "on" : "off");

/* ==========================================================================
   SOUND (Web Audio, muted by default)
   ========================================================================== */

let actx = null;

function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return;
    actx = new AC();
  }
  if (actx.state === "suspended") actx.resume();
}

function tone(freq, dur, { type = "sine", gain = 0.08, slideTo = null, delay = 0 } = {}) {
  if (!state.sound || !actx) return;
  const t0 = actx.currentTime + delay;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(actx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

let lastAlarm = 0;
const sfx = {
  sweep: () => tone(70, 0.9, { gain: 0.2, slideTo: 40 }),
  click: () => tone(1800, 0.03, { type: "square", gain: 0.03 }),
  alarm: () => {
    const now = performance.now();
    if (now - lastAlarm < 1500) return; // don't stack alarms
    lastAlarm = now;
    tone(880, 0.15, { type: "square", gain: 0.05 });
    tone(660, 0.15, { type: "square", gain: 0.05, delay: 0.2 });
    tone(880, 0.15, { type: "square", gain: 0.05, delay: 0.4 });
  },
};
hooks.alarm = sfx.alarm;
hooks.sweep = sfx.sweep;

/* ==========================================================================
   PANELS
   ========================================================================== */

const shownConflicts = (view) => view.conflicts.filter((c) => passFilter(c.a) || passFilter(c.b));

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inRange(p) {
  return Math.hypot(p.x, p.y) <= state.range;
}

function selectedView() {
  return state.view.planes.find((p) => p.cs === state.selectedCs) || null;
}

function updatePanels(dt) {
  const view = state.view;
  const live = state.source === "live";

  el.utc.textContent = new Date().toISOString().slice(11, 19) + "Z";
  el.mode.textContent = state.range <= 5 ? "APPROACH" : state.range <= 15 ? "TERMINAL" : "LONG RANGE";
  el.src.textContent = live ? "LIVE · OPENSKY" : state.replay.active ? "REPLAY" : "SIM";
  const active = view.planes.filter((p) => inRange(p) && passFilter(p));
  el.targets.textContent = active.length;
  el.wind.textContent = live ? "---" : `${pad(state.wind.dir)}/${pad(state.wind.spd, 2)}KT`;
  el.arrdep.textContent = `${state.score.landed}/${state.score.departed}`;

  // latency is only meaningful (and measured) for the live data feed
  el.latencyItem.hidden = !live;
  el.latency.textContent = state.live.rtt != null ? `${state.live.rtt} ms` : "-- ms";

  el.scoreItem.hidden = !state.training;
  const sc = state.score;
  el.score.textContent = sc.points;
  el.scoreDetail.textContent = i18n("score.detail", { r: sc.resolved, v: sc.violations, a: sc.infringements });
  el.scoreDetail.title = i18n("score.title");

  // the FL filter hides targets everywhere: list, scope, conflict panel and SYS status
  const conflicts = shownConflicts(view);
  const hasConflict = conflicts.some((c) => c.level === "CONFLICT");
  const hasEmerg = view.planes.some((p) => p.emergency && passFilter(p));
  let sys = "OK", cls = "";
  if (live && state.live.error) { sys = "LIVE ERR"; cls = "traffic"; }
  if (conflicts.length) { sys = "TRAFFIC"; cls = "traffic"; }
  if (hasEmerg) { sys = "EMERGENCY"; cls = "alert"; }
  if (hasConflict) { sys = "COLLISION ALERT"; cls = "alert"; }
  el.sys.textContent = sys;
  el.sys.className = `v ${cls}`;
  el.simtime.textContent = fmtClock(state.simTime);

  renderTable(active);
  renderDetail();
  renderConflicts();
  updatePreview();
  renderTimeline();
  if (state.logDirty) renderLog();
}

function renderTable(list) {
  const k = state.sortKey;
  const sorted = [...list].sort((a, b) => {
    const r = k === "cs" ? a.cs.localeCompare(b.cs) : (a[k] ?? 0) - (b[k] ?? 0);
    return r * state.sortDir;
  });
  el.rows.innerHTML = sorted
    .map((p) => {
      const cls = [
        p.cs === state.selectedCs ? "selected" : "",
        p.status ? p.status.toLowerCase() : "",
        p.emergency ? "emergency" : "",
        p.primary ? "primary" : "",
      ].join(" ");
      const fl = p.primary ? "---" : `${pad(p.alt / 100)}${vsArrow(p.vs)}`;
      return `<tr data-cs="${escapeHtml(p.cs)}" class="${cls}">
        <td>${escapeHtml(p.cs)}</td><td>${fl}</td><td>${pad(p.gs)}</td><td>${pad(p.hdg)}</td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll(".targets th").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === k);
    th.classList.toggle("asc", th.dataset.sort === k && state.sortDir === 1);
  });
}

function navText(p) {
  if (p.replay) return i18n("nav.replay");
  if (p.primary) return i18n("nav.vfr");
  if (p.live) return "OpenSky ADS-B";
  let t;
  if (p.ilsState === "LOC") t = `ILS ${AIRPORT.rwy} · LOC/GS`;
  else if (p.ilsCleared) t = `CLEARED ILS → KOPRU`;
  else if (p.departureExit) t = i18n("nav.departure", { exit: p.departureExit });
  else if (p.route.length) t = `DCT ${p.route.join(" → ")}`;
  else if (p.assignedHdg != null) t = `HDG ${pad(p.assignedHdg || 360)}`;
  else t = "—";
  if (p.resume && !p.route.length) t += i18n("nav.resume", { to: p.resume.route[0] ?? "ILS" });
  if (p.wxAvoid) t += i18n("nav.wx");
  return t;
}

function renderDetail() {
  const p = selectedView();
  const canCommand = p && !p.replay && !p.live && !p.primary;
  el.cmdPanel.hidden = !canCommand;

  if (!p) {
    el.detail.innerHTML = `<p class="empty">${i18n("detail.empty")}</p>`;
    el.proj.hidden = true;
    return;
  }

  const rng = Math.hypot(p.x, p.y);
  const brg = bearingOf(p.x, p.y);
  const rows = [["CALLSIGN", p.cs + (p.replay ? " <span class='k'>(REPLAY)</span>" : "")]];
  if (p.primary) {
    rows.push(["TYPE", i18n("detail.primary")], ["ALT", i18n("detail.noModeC")]);
  } else {
    const altTxt = Math.abs(p.targetAlt - p.alt) >= 100
      ? `FL${pad(p.alt / 100)} ${vsArrow(p.vs)} FL${pad(p.targetAlt / 100)}`
      : `FL${pad(p.alt / 100)}`;
    const sq = p.emergency ? `<span class="badge EMERGENCY">${p.squawk} ${EMERGENCY[p.emergency]}</span>` : p.squawk;
    rows.push(
      ["TYPE", escapeHtml(p.type)],
      ["SQUAWK", sq],
      ["ALT", altTxt],
      ["V/S", `${p.vs > 0 ? "+" : ""}${Math.round(p.vs)} FPM`],
    );
  }
  rows.push(
    ["TAS / GS", p.live ? `— / ${pad(p.gs)} KT` : `${pad(p.spd)} / ${pad(p.gs)} KT`],
    ["HDG / TRK", `${pad(p.hdg)}° / ${pad(p.trk)}°`],
    ["BRG / RNG", `${pad(brg)}° / ${rng.toFixed(1)} NM`],
  );
  if (!p.primary) rows.push(["ROUTE", `${escapeHtml(p.origin)} → ${escapeHtml(p.dest)}`]);
  rows.push(["NAV", navText(p)]);
  if (!p.replay && p.arrival) rows.push(["THR", `${Math.hypot(p.x - THR.x, p.y - THR.y).toFixed(1)} NM`]);
  const status = `<span class="badge ${p.status}">${p.status}</span>` +
    (p.areaAlert ? ` <span class="badge AREA">${p.areaAlert}</span>` : "");
  rows.push(["STATUS", status]);

  el.detail.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  el.proj.hidden = !!p.primary;
  el.proj.classList.toggle("active", state.projection);
  el.proj.textContent = i18n("proj", { s: onOff(state.projection) });
}

function renderConflicts() {
  const list = shownConflicts(state.view);
  if (!list.length) {
    el.conflicts.innerHTML = `<li class="empty">${i18n("cf.none")}</li>`;
    return;
  }
  const canAdvise = state.source === "sim" && !state.replay.active;
  el.conflicts.innerHTML = list
    .map((c) => {
      const meta = c.level === "CONFLICT"
        ? i18n("cf.loss", { dh: c.dh.toFixed(1), dv: Math.round(c.dv) })
        : i18n("cf.traffic", { t: Math.round(c.tcpa), d: c.dcpa.toFixed(1), now: c.dh.toFixed(1) });
      return `<li class="${c.level}" data-cs="${escapeHtml(c.a.cs)}">
        <div class="pair">${escapeHtml(c.a.cs)} ⇄ ${escapeHtml(c.b.cs)} — ${c.level}</div>
        <div class="meta">${meta}</div>
        ${canAdvise ? advisoryHtml(c) : ""}
      </li>`;
    })
    .join("");
}

/** Resolution advisories (click = issue). In training they cost HINT_COST points to reveal. */
function advisoryHtml(c) {
  const key = pairKey(c.a, c.b);
  if (state.training && !state.pairs.get(key)?.hinted) {
    return `<div class="adv"><button type="button" data-hint="${escapeHtml(key)}">${i18n("cf.hint", { cost: HINT_COST })}</button></div>`;
  }
  const adv = adviseConflict(c);
  if (!adv.length) return `<div class="adv"><span class="none">${i18n("cf.noAdvice")}</span></div>`;
  return `<div class="adv"><span class="k">${i18n("cf.advice")}</span>${adv
    .map((a) => {
      const also = a.also
        ? ` data-adv-cs2="${escapeHtml(a.also.cs)}" data-adv-cmd2="${a.also.text}"` : "";
      const label = `${escapeHtml(a.cs)} ${a.text}` + (a.also ? ` + ${escapeHtml(a.also.cs)} ${a.also.text}` : "");
      return `<button type="button" data-adv-cs="${escapeHtml(a.cs)}" data-adv-cmd="${a.text}"${also}
        title="${i18n("cf.advTitle")}">${label}</button>`;
    })
    .join("")}</div>`;
}

const advFromEl = (b) => b && {
  cs: b.dataset.advCs, text: b.dataset.advCmd,
  also: b.dataset.advCs2 ? { cs: b.dataset.advCs2, text: b.dataset.advCmd2 } : null,
};

/* ---------- clearance preview (conflict probe) ---------- */

let hoverAdv = null; // { cs, text, also } — advisory under the pointer

function formText() {
  const parts = [];
  if (el.cmdHdg.value) parts.push(`HDG ${el.cmdHdg.value}`);
  if (el.cmdFl.value) parts.push(`FL ${el.cmdFl.value}`);
  if (el.cmdSpd.value) parts.push(`SPD ${el.cmdSpd.value}`);
  return parts.join(" ");
}

/** What clearance, if any, should be previewed right now. */
function previewRequest() {
  if (state.replay.active || state.source !== "sim") return null;
  const vd = state.vectorDrag;
  if (vd && vd.moved) return { cs: vd.cs, text: `HDG ${vd.hdg || 360}`, src: "drag" };
  if (hoverAdv) return { ...hoverAdv, src: "adv" };
  if (!state.selectedCs) return null;
  const focus = document.activeElement;
  if (focus === el.cmdLine && el.cmdLine.value.trim()) return { cs: state.selectedCs, text: el.cmdLine.value, src: "line" };
  if (el.cmdForm.contains(focus) && formText()) return { cs: state.selectedCs, text: formText(), src: "form" };
  return null;
}

function updatePreview() {
  const req = previewRequest();
  state.preview = null;
  let msg = "", cls = "cmd-probe";
  const p = req && state.planes.find((q) => q.cs === req.cs);
  if (p) {
    const parsed = parseCommand(p, req.text);
    if (!parsed.ok) {
      if (req.src === "line" || req.src === "form") { msg = parsed.msg; cls += " err"; }
    } else if (parsed.probe) {
      // a two-aircraft advisory previews both new paths
      const q = req.also && state.planes.find((o) => o.cs === req.also.cs);
      const qp = q && parseCommand(q, req.also.text);
      const extra = qp?.ok && qp.probe ? [{ cs: q.cs, path: forecast(q, qp.probe) }] : [];
      const override = new Map(extra.map((e) => [e.cs, e.path]));
      const r = probeCommand(p, parsed.probe, undefined, { override });
      state.preview = { cs: p.cs, path: r.path, losses: r.losses, extra };
      const L = r.losses[0];
      const min = PROBE_T / 60;
      if (!L) msg = i18n("probe.clear", { cs: p.cs, rb: parsed.readback.join(", "), min });
      else {
        cls += " warn";
        msg = L.t > 0
          ? i18n("probe.conflict", { cs: L.cs, t: fmtMinSec(L.t), d: L.dh.toFixed(1) })
          : L.end >= PROBE_T
            ? i18n("probe.ongoingNever", { cs: L.cs, min })
            : i18n("probe.ongoing", { cs: L.cs, when: fmtMinSec(L.end + PROBE_DT) });
        if (r.losses.length > 1) msg += i18n("probe.more", { n: r.losses.length - 1 });
      }
    } else if (req.src !== "adv") {
      msg = i18n("probe.noPath");
    }
  }
  // only the panel of the plane being previewed shows the text
  const own = req && req.cs === state.selectedCs;
  el.cmdProbe.textContent = own ? msg : "";
  el.cmdProbe.className = cls;
}

function renderLog() {
  state.logDirty = false;
  if (!state.log.length) {
    el.log.innerHTML = `<li class="empty">${i18n("log.empty")}</li>`;
    return;
  }
  el.log.innerHTML = state.log
    .slice(0, 150)
    .map((e) => `<li class="ev-${e.type.replace(/\s/g, "-")}" data-t="${e.t}" data-cs="${escapeHtml(e.cs[0] || "")}">
        <span class="lt">${fmtClock(e.t)}</span>
        <span class="ltype">${e.type}</span>
        <span class="lmsg">${escapeHtml(logText(e))}</span>
      </li>`)
    .join("");
}

let timelineDragging = false;

function renderTimeline() {
  const H = state.history;
  const first = H.length ? H[0].t : 0;
  const last = H.length ? H[H.length - 1].t : 0;
  const span = Math.max(last - first, 1e-6);
  if (!timelineDragging) {
    el.timeline.value = state.replay.active ? Math.round(((state.replay.t - first) / span) * 1000) : 1000;
  }
  el.timelineLabel.textContent = state.replay.active
    ? i18n("tl.replay", { t: fmtClock(state.replay.t), end: fmtClock(last) })
    : i18n("tl.now", { rec: fmtClock(last - first) });
  el.liveBtn.classList.toggle("active", !state.replay.active);
  el.timelineLabel.classList.toggle("replay", state.replay.active);
}

/* ==========================================================================
   REPLAY
   ========================================================================== */

function enterReplay(t) {
  const H = state.history;
  if (!H.length) return;
  state.replay.active = true;
  state.replay.t = clamp(t, H[0].t, H[H.length - 1].t);
  setPlaying(false);
  state.view = currentView();
  updatePanels(0);
}

function goLive() {
  state.replay.active = false;
  setPlaying(true);
  state.view = currentView();
  updatePanels(0);
}

el.timeline.addEventListener("pointerdown", () => (timelineDragging = true));
window.addEventListener("pointerup", () => (timelineDragging = false));
el.timeline.addEventListener("input", () => {
  const H = state.history;
  if (!H.length) return;
  const first = H[0].t, last = H[H.length - 1].t;
  const v = Number(el.timeline.value);
  if (v >= 1000 && state.replay.active) return goLive();
  if (v < 1000) enterReplay(first + ((last - first) * v) / 1000);
});
el.liveBtn.addEventListener("click", goLive);

/* ==========================================================================
   INTERACTION — canvas
   ========================================================================== */

function select(cs) {
  state.selectedCs = cs;
  el.cmdMsg.textContent = "";
  sfx.click();
  updatePanels(0);
}

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function viewTargets() {
  return state.view.planes.filter((p) => visible(p) && passFilter(p));
}

function hitPlane(pt) {
  let best = null, bestD = 14;
  for (const p of viewTargets()) {
    const [sx, sy] = toScreen(p.disp.x, p.disp.y);
    const d = Math.hypot(pt.x - sx, pt.y - sy);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / L2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitVector(pt) {
  for (const p of viewTargets()) {
    if (p.primary) continue;
    const [sx, sy] = toScreen(p.disp.x, p.disp.y);
    const tr = deg2rad(p.disp.trk);
    const L = (p.disp.gs / 60) * geo.scale;
    if (distToSegment(pt.x, pt.y, sx, sy, sx + Math.sin(tr) * L, sy - Math.cos(tr) * L) < 6) return p;
  }
  return null;
}

function hitLabel(pt) {
  for (let i = labelRects.length - 1; i >= 0; i--) {
    const r = labelRects[i];
    if (pt.x >= r.x - 2 && pt.x <= r.x + r.w + 2 && pt.y >= r.y - 2 && pt.y <= r.y + r.h + 2) return r;
  }
  return null;
}

let drag = null;
let suppressClick = false;

canvas.addEventListener("pointerdown", (e) => {
  if (state.ruler.active || e.button !== 0) return;
  const pt = canvasPoint(e);
  const lb = hitLabel(pt);
  if (lb) {
    drag = { cs: lb.cs, offX: pt.x - lb.x, offY: pt.y - lb.y, sx: pt.x, sy: pt.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  // drag from the *selected* blip = vector it (heading toward the pointer);
  // other blips only select, so a slightly moving click never issues a heading
  const p = hitPlane(pt);
  const live = p && p.cs === state.selectedCs && !state.replay.active && state.planes.find((q) => q.cs === p.cs);
  if (live && commandable(live)) {
    state.vectorDrag = { cs: p.cs, hdg: Math.round(live.hdg) || 360, sx: pt.x, sy: pt.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }
});

function dragHeading(vd, pt) {
  const p = state.planes.find((q) => q.cs === vd.cs);
  if (!p || !p.disp) return vd.hdg;
  const [sx, sy] = toScreen(p.disp.x, p.disp.y);
  // the pointer marks the desired ground track; fly the wind-corrected heading, rounded to 5°
  const trk = bearingOf(pt.x - sx, sy - pt.y);
  return Math.round(headingForTrack(trk, p.spd) / 5) * 5 % 360 || 360;
}

canvas.addEventListener("pointermove", (e) => {
  const pt = canvasPoint(e);
  state.mouse = pt;
  const vd = state.vectorDrag;
  if (vd) {
    if (Math.hypot(pt.x - vd.sx, pt.y - vd.sy) > 25) vd.moved = true;
    if (vd.moved) {
      vd.hdg = dragHeading(vd, pt);
      updatePreview();
    }
    canvas.style.cursor = "crosshair";
    return;
  }
  if (drag) {
    if (Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > 3) drag.moved = true;
    const p = state.view.planes.find((q) => q.cs === drag.cs);
    if (drag.moved && p && p.disp) {
      const [bx, by] = toScreen(p.disp.x, p.disp.y);
      const st = labelState.get(drag.cs);
      if (st) {
        st.manual = true;
        st.dx = pt.x - drag.offX - bx;
        st.dy = pt.y - drag.offY - by;
      }
    }
    canvas.style.cursor = "grabbing";
    return;
  }
  if (state.ruler.active) canvas.style.cursor = "crosshair";
  else if (hitLabel(pt)) canvas.style.cursor = "move";
  else canvas.style.cursor = hitPlane(pt) || hitVector(pt) ? "pointer" : "default";
});

canvas.addEventListener("pointerup", () => {
  const vd = state.vectorDrag;
  if (vd) {
    state.vectorDrag = null;
    if (vd.moved) {
      suppressClick = true;
      issue(`HDG ${vd.hdg}`);
    }
    return;
  }
  if (!drag) return;
  suppressClick = true;
  if (!drag.moved) select(drag.cs);
  drag = null;
});

canvas.addEventListener("pointerleave", () => (state.mouse = null));

canvas.addEventListener("dblclick", (e) => {
  const lb = hitLabel(canvasPoint(e));
  if (lb) labelState.delete(lb.cs); // back to automatic placement
});

canvas.addEventListener("click", (e) => {
  if (suppressClick) { suppressClick = false; return; }
  const pt = canvasPoint(e);
  const onBlip = hitPlane(pt);
  const onVector = onBlip ? null : hitVector(pt);
  const p = onBlip || onVector;

  if (state.ruler.active) {
    const r = state.ruler;
    if (!p) r.a = r.b = null;
    else if (!r.a || r.b) { r.a = p.cs; r.b = null; }
    else if (p.cs !== r.a) r.b = p.cs;
    sfx.click();
    return;
  }
  if (!p) {
    state.selectedCs = null;
    updatePanels(0);
    return;
  }
  if (onVector) state.projection = state.selectedCs === p.cs ? !state.projection : true;
  select(p.cs);
});

/* ==========================================================================
   INTERACTION — panels
   ========================================================================== */

// Lists re-render several times a second; select on pointerdown so clicks aren't lost.
el.rows.addEventListener("pointerdown", (e) => {
  const tr = e.target.closest("tr[data-cs]");
  if (tr) select(tr.dataset.cs);
});

el.conflicts.addEventListener("pointerdown", (e) => {
  const adv = advFromEl(e.target.closest("[data-adv-cmd]"));
  if (adv) {
    hoverAdv = null;
    if (adv.also) {
      const r2 = applyCommand(state.planes.find((q) => q.cs === adv.also.cs), adv.also.text);
      select(adv.cs);
      if (issue(adv.text) && r2.ok) el.cmdMsg.textContent += ` · ${r2.msg}`;
    } else {
      select(adv.cs);
      issue(adv.text);
    }
    return;
  }
  const hint = e.target.closest("[data-hint]");
  if (hint) {
    buyHint(hint.dataset.hint);
    sfx.click();
    updatePanels(0);
    return;
  }
  const li = e.target.closest("li[data-cs]");
  if (li) select(li.dataset.cs);
});

// hovering an advisory previews it on the scope
el.conflicts.addEventListener("pointermove", (e) => {
  const next = advFromEl(e.target.closest("[data-adv-cmd]"));
  const id = (a) => (a ? `${a.cs} ${a.text} ${a.also?.cs} ${a.also?.text}` : "");
  if (id(next) !== id(hoverAdv)) {
    hoverAdv = next;
    updatePreview();
  }
});
el.conflicts.addEventListener("pointerleave", () => {
  hoverAdv = null;
  updatePreview();
});

el.log.addEventListener("pointerdown", (e) => {
  const li = e.target.closest("li[data-t]");
  if (!li) return;
  enterReplay(Number(li.dataset.t) - 3);
  if (li.dataset.cs) select(li.dataset.cs);
});

el.proj.addEventListener("click", () => {
  state.projection = !state.projection;
  sfx.click();
  updatePanels(0);
});

document.querySelectorAll(".targets th").forEach((th) => {
  th.addEventListener("click", () => {
    const k = th.dataset.sort;
    state.sortDir = state.sortKey === k ? -state.sortDir : 1;
    state.sortKey = k;
    updatePanels(0);
  });
});

/* ---------- commands ---------- */

function liveSelected() {
  return state.planes.find((p) => p.cs === state.selectedCs) || null;
}

function issue(text) {
  const res = applyCommand(liveSelected(), text);
  el.cmdMsg.textContent = res.msg;
  el.cmdMsg.className = `cmd-msg ${res.ok ? "ok" : "err"}`;
  sfx.click();
  updatePanels(0);
  return res.ok;
}

Object.keys(FIXES).sort().forEach((name) => {
  const o = document.createElement("option");
  o.value = name;
  o.textContent = `DCT ${name}`;
  el.cmdDct.append(o);
});

el.cmdForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = formText();
  if (!text) {
    el.cmdMsg.textContent = i18n("cmd.enterValue");
    el.cmdMsg.className = "cmd-msg err";
    return;
  }
  if (issue(text)) el.cmdHdg.value = el.cmdFl.value = el.cmdSpd.value = "";
  updatePreview();
});

// live preview while typing / leaving the fields
for (const input of [el.cmdLine, el.cmdHdg, el.cmdFl, el.cmdSpd]) {
  input.addEventListener("input", updatePreview);
  input.addEventListener("focus", updatePreview);
  input.addEventListener("blur", () => setTimeout(updatePreview, 0));
}
el.cmdNav.addEventListener("click", () => issue("NAV"));
canvas.addEventListener("pointercancel", () => {
  state.vectorDrag = null;
  drag = null;
});

el.cmdDct.addEventListener("change", () => {
  if (el.cmdDct.value) issue(`DCT ${el.cmdDct.value}`);
  el.cmdDct.value = "";
});
el.cmdIls.addEventListener("click", () => issue("ILS"));
el.cmdRes.addEventListener("click", () => issue("RES"));

el.cmdLine.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (issue(el.cmdLine.value)) el.cmdLine.value = "";
    updatePreview();
  } else if (e.key === "Escape") {
    el.cmdLine.blur();
  }
});

document.querySelectorAll("[data-sq]").forEach((b) =>
  b.addEventListener("click", () => {
    const p = liveSelected();
    if (!p || p.primary) return;
    if (b.dataset.sq === "reset") clearEmergency(p);
    else setEmergency(p, b.dataset.sq);
    updatePanels(0);
  })
);

/* ---------- footer controls ---------- */

function setActive(groupId, btn) {
  document.querySelectorAll(`#${groupId} button`).forEach((b) => b.classList.toggle("active", b === btn));
}

function setRange(r) {
  state.range = r;
  updateGeometry();
  setActive("range-group", document.querySelector(`#range-group [data-range="${r}"]`));
  updatePanels(0);
}

document.querySelectorAll("#range-group button").forEach((b) =>
  b.addEventListener("click", () => setRange(Number(b.dataset.range)))
);

function setSimSpeed(v) {
  state.simSpeed = v;
  setActive("speed-group", document.querySelector(`#speed-group [data-speed="${v}"]`));
}

document.querySelectorAll("#speed-group button").forEach((b) =>
  b.addEventListener("click", () => {
    if (state.source === "live" && !state.replay.active) return; // live data runs in real time
    setSimSpeed(Number(b.dataset.speed));
  })
);

document.querySelectorAll("#layer-group button").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.layer;
    state.layers[k] = !state.layers[k];
    b.classList.toggle("active", state.layers[k]);
  })
);

function readFlFilter() {
  const a = clamp(num(el.flMin.value, 0), 0, 600);
  const b = clamp(num(el.flMax.value, 600), 0, 600);
  state.flMin = Math.min(a, b);
  state.flMax = Math.max(a, b);
  updatePanels(0);
}
el.flMin.addEventListener("change", readFlFilter);
el.flMax.addEventListener("change", readFlFilter);

el.rpm.addEventListener("input", () => {
  state.rpm = Number(el.rpm.value);
  el.rpmVal.textContent = `${state.rpm} RPM`;
});

function setPlaying(on) {
  const resumed = on && !state.playing;
  state.playing = on;
  el.play.textContent = i18n(on ? "btn.pause" : "btn.play");
  el.play.classList.toggle("active", !on);
  // live data is not polled while paused; catch up immediately on resume
  if (resumed && state.source === "live" && !state.replay.active) fetchLive();
}

function togglePlay() {
  setPlaying(!state.playing);
}

function toggleRuler() {
  const r = state.ruler;
  r.active = !r.active;
  r.a = r.b = null;
  el.ruler.classList.toggle("active", r.active);
  el.hint.classList.toggle("ruler", r.active);
  el.hint.textContent = hintText();
}

function toggleSound() {
  state.sound = !state.sound;
  if (state.sound) ensureAudio();
  el.sound.textContent = i18n("btn.sound", { s: onOff(state.sound) });
  el.sound.classList.toggle("active", state.sound);
  sfx.click();
}

function setTraining(on, announce = true) {
  const changed = state.training !== on;
  state.training = on;
  el.training.textContent = i18n("btn.training", { s: onOff(on) });
  el.training.classList.toggle("active", on);
  if (on) {
    state.score = emptyScore();
    state.nextEngineer = state.simTime + 20;
    // arrivals not yet on the localizer now need an explicit ILS clearance
    state.planes.forEach((p) => { if (p.arrival && p.ilsState !== "LOC" && p.emergency !== "7700") p.ilsCleared = false; });
    if (announce) logEvent("SYSTEM", "log.trainingOn");
  } else {
    // automatic ILS clearance again — except for arrivals the controller is vectoring
    state.planes.forEach((p) => { if (p.arrival && p.assignedHdg == null) p.ilsCleared = true; });
    if (announce && changed) logEvent("SYSTEM", "log.trainingOff");
  }
  updatePanels(0);
}

el.play.addEventListener("click", togglePlay);
el.ruler.addEventListener("click", toggleRuler);
el.sound.addEventListener("click", toggleSound);
el.training.addEventListener("click", () => {
  if (state.source === "live") return;
  setTraining(!state.training);
});

/* ---------- scenarios ---------- */

function afterLoad() {
  setPlaying(true);
  setTraining(state.training, false);
  state.view = currentView();
  updatePanels(0);
}

let fileScenario = null; // last scenario loaded from a file, so ↻ restarts it

function loadBuiltin(key) {
  if (state.source === "live") return;
  if (key === "random") initRandomTraffic();
  else if (key === "file" && fileScenario) loadScenario(fileScenario);
  else loadScenario(BUILTIN_SCENARIOS[key]);
  afterLoad();
}

function showFileOption() {
  el.scnFileOpt.hidden = !fileScenario;
  if (fileScenario) el.scnFileOpt.textContent = i18n("scn.file", { name: String(fileScenario.name || "—").slice(0, 40) });
}

el.scenario.addEventListener("change", () => loadBuiltin(el.scenario.value));
el.scnReload.addEventListener("click", () => loadBuiltin(el.scenario.value));
el.scnLoad.addEventListener("click", () => {
  if (state.source !== "live") el.scnFile.click();
});

el.scnFile.addEventListener("change", async () => {
  const file = el.scnFile.files[0];
  el.scnFile.value = "";
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error(i18n("err.fileTooBig"));
    const sc = JSON.parse(await file.text());
    loadScenario(sc);
    fileScenario = sc;
    showFileOption();
    el.scenario.value = "file";
    afterLoad();
  } catch (err) {
    logEvent("SYSTEM", "log.scnFailed", { err: err.message });
    updatePanels(0);
  }
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

el.scnSave.addEventListener("click", () => {
  if (state.source === "live") return;
  download(`radar-senaryo-${stamp()}.json`, JSON.stringify(exportScenario(), null, 2), "application/json");
});

el.logCsv.addEventListener("click", () => {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [["sim_time", "utc", "type", "callsigns", "message"].join(",")];
  for (const e of [...state.log].reverse()) {
    rows.push([fmtClock(e.t), e.utc, e.type, e.cs.join(" "), logText(e)].map(q).join(","));
  }
  download(`radar-olaylar-${stamp()}.csv`, "﻿" + rows.join("\r\n"), "text/csv;charset=utf-8");
});

/* ==========================================================================
   LIVE DATA (OpenSky via local proxy in server.js)
   ========================================================================== */

const LIVE_POLL = 15000;

async function fetchLive() {
  if (state.live.busy || state.source !== "live" || !state.playing) return;
  state.live.busy = true;
  const lat0 = AIRPORT.lat, lon0 = AIRPORT.lon;
  const dLat = LIVE_RADIUS / 60;
  const dLon = LIVE_RADIUS / (60 * Math.cos(deg2rad(lat0)));
  const qs = `lamin=${(lat0 - dLat).toFixed(3)}&lomin=${(lon0 - dLon).toFixed(3)}` +
             `&lamax=${(lat0 + dLat).toFixed(3)}&lomax=${(lon0 + dLon).toFixed(3)}`;
  const t0 = performance.now();
  try {
    const res = await fetch(`api/opensky?${qs}`);
    if (res.status === 404) throw new Error(i18n("err.noProxy"));
    if (res.status === 429) throw new Error(i18n("err.rateLimit"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.live.rtt = Math.round(performance.now() - t0);
    if (state.source !== "live") return;
    ingestLive(Array.isArray(data.states) ? data.states : [], data.time);
    if (state.live.error) logEvent("LIVE", "log.liveRestored");
    state.live.error = null;
  } catch (err) {
    if (state.live.error !== err.message) logEvent("LIVE", "log.liveError", { err: err.message });
    state.live.error = err.message;
  } finally {
    state.live.busy = false;
  }
}

function ingestLive(rows, dataTime) {
  const seen = new Set();
  const byId = new Map(state.planes.map((p) => [p.icao, p]));
  const cosLat = Math.cos(deg2rad(AIRPORT.lat));
  for (const r of rows) {
    const [icao, csRaw, country, timePos, , lon, lat, baro, onGround, velocity, track, vrate, , geoAlt, squawk] = r;
    if (lat == null || lon == null || onGround) continue;
    // Each position has its own timestamp; bring them all to the response time
    // (otherwise a 15 s old fix at 450 kt is ~2 NM off and triggers false alerts).
    const age = dataTime && timePos ? Math.max(0, dataTime - timePos) : 0;
    if (age > 60) continue; // lost contact
    const spd = (velocity ?? 0) * 1.94384;
    const hdg = track ?? 0;
    const vs = (vrate ?? 0) * 196.85;
    const moved = (spd / 3600) * age;
    const x = (lon - AIRPORT.lon) * 60 * cosLat + Math.sin(deg2rad(hdg)) * moved;
    const y = (lat - AIRPORT.lat) * 60 + Math.cos(deg2rad(hdg)) * moved;
    if (Math.hypot(x, y) > LIVE_RADIUS) continue;
    const fields = {
      x, y, hdg, spd, vs,
      alt: Math.max(0, (baro ?? geoAlt ?? 0) * 3.28084 + (vs * age) / 60),
    };
    let p = byId.get(icao);
    if (!p) {
      p = makePlane({
        live: true, cs: String(csRaw || "").trim() || String(icao).toUpperCase(),
        type: "----", origin: country || "----", dest: "----", squawk: "----",
        ...fields,
      });
      p.icao = icao;
      state.planes.push(p);
    }
    Object.assign(p, fields);
    p.targetAlt = p.alt;
    const sq = squawk ? String(squawk) : "----";
    if (EMERGENCY[sq] && p.emergency !== sq) setEmergency(p, sq);
    else if (!EMERGENCY[sq]) { p.emergency = null; p.squawk = sq; }
    updateGround(p);
    seen.add(icao);
  }
  state.planes = state.planes.filter((p) => {
    if (seen.has(p.icao)) return true;
    forgetPlane(p);
    return false;
  });
}

function setSource(src) {
  if (src === state.source) return;
  clearInterval(state.live.timer);
  state.live.timer = null;
  if (src === "live") {
    resetSim();
    state.source = "live";
    state.autoSpawn = false;
    state.wx = [];
    state.live.error = null;
    if (state.training) setTraining(false);
    setSimSpeed(1);
    setRange(LIVE_RADIUS);
    logEvent("LIVE", "log.liveStart", { icao: AIRPORT.icao, r: LIVE_RADIUS, s: LIVE_POLL / 1000 });
    fetchLive();
    state.live.timer = setInterval(fetchLive, LIVE_POLL);
  } else {
    state.source = "sim";
    initRandomTraffic();
    el.scenario.value = "random";
    setRange(15);
  }
  el.source.textContent = i18n("btn.source", { s: i18n(src === "live" ? "src.live" : "src.sim") });
  el.source.classList.toggle("active", src === "live");
  document.body.classList.toggle("live-mode", src === "live");
  afterLoad();
}

el.source.addEventListener("click", () => setSource(state.source === "live" ? "sim" : "live"));

/* ---------- keyboard ---------- */

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  const ranges = { 1: 5, 2: 10, 3: 15, 4: 30, 5: 60 };
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key === "r" || e.key === "R") toggleRuler();
  else if (e.key === "m" || e.key === "M") toggleSound();
  else if (e.key === "/") {
    if (!el.cmdPanel.hidden) { e.preventDefault(); el.cmdLine.focus(); }
  } else if (e.key === "Escape") {
    if (state.vectorDrag) state.vectorDrag = null;
    else if (state.ruler.active) toggleRuler();
    else if (state.replay.active) goLive();
    else { state.selectedCs = null; updatePanels(0); }
  } else if (ranges[e.key]) setRange(ranges[e.key]);
});

/* ==========================================================================
   MAIN LOOP
   ========================================================================== */

function tick(dt) {
  const sdt = dt * state.simSpeed;
  state.simTime += sdt;
  if (state.source === "sim") {
    updateWind(sdt);
    updateWeather(sdt);
  }
  for (const p of state.planes) updatePlane(p, sdt);
  replenish();
  advanceSweep(dt);
  detectConflicts();
  if (state.source === "sim") {
    maybeEngineer();
    randomEmergency();
  }
  recordSnapshot();
}

let last = performance.now();
let panelTimer = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  if (state.replay.active) {
    if (state.playing) {
      state.replay.t += dt * state.simSpeed;
      const H = state.history;
      if (!H.length || state.replay.t >= H[H.length - 1].t) goLive();
      else advanceSweep(dt, false);
    }
  } else if (state.playing) {
    tick(dt);
  }

  state.view = currentView();
  draw(now);

  panelTimer += dt;
  if (panelTimer >= 0.25) {
    updatePanels(panelTimer);
    panelTimer = 0;
  }
  requestAnimationFrame(frame);
}

/* ---------- language ---------- */

/** Re-apply every translated text (static markup, stateful buttons, log, panels). */
function refreshTexts() {
  applyStaticI18n();
  el.lang.textContent = LANG === "en" ? "EN · tr" : "en · TR";
  el.lang.title = i18n("lang.title");
  el.hint.textContent = hintText();
  el.play.textContent = i18n(state.playing ? "btn.pause" : "btn.play");
  el.sound.textContent = i18n("btn.sound", { s: onOff(state.sound) });
  el.training.textContent = i18n("btn.training", { s: onOff(state.training) });
  el.source.textContent = i18n("btn.source", { s: i18n(state.source === "live" ? "src.live" : "src.sim") });
  showFileOption();
  el.cmdMsg.textContent = ""; // transient message from before the switch
  state.logDirty = true;
  updatePanels(0);
}

el.lang.addEventListener("click", () => {
  setLang(LANG === "en" ? "tr" : "en");
  refreshTexts();
});

function init() {
  initRandomTraffic();
  detectConflicts();
  state.view = currentView();
  new ResizeObserver(resize).observe(canvas);
  resize();
  refreshTexts();
  requestAnimationFrame(frame);
}

init();
