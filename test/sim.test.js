"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSim } = require("./harness");

const T = createSim();
const s = T.state;
const free = () => s.planes.find((p) => !p.primary && !p.live);

test.beforeEach(() => {
  s.source = "sim";
  s.playing = true;
  s.training = false;
  s.flMin = 0;
  s.flMax = 600;
  T.setLang("en");
});

test("parseCommand has no side effects and rejects bad input", () => {
  T.loadScenario(T.BUILTIN_SCENARIOS.crossing);
  const p = free();
  const before = JSON.stringify([p.route, p.assignedHdg, p.targetAlt]);
  const r = T.parseCommand(p, "HDG 090 FL 200 DCT TUZLA");
  assert.ok(r.ok);
  assert.equal(JSON.stringify([p.route, p.assignedHdg, p.targetAlt]), before);
  for (const bad of ["HDG 400", "FL 12.5", "XYZ"]) assert.equal(T.parseCommand(p, bad).ok, false, bad);
});

test("NAV returns a vectored aircraft to its route", () => {
  T.fresh([{ cs: "V1", x: -10, y: 10, fl: 300, spd: 400, route: ["TUZLA", "MENEK"] }]);
  const p = s.planes[0];
  assert.ok(T.applyCommand(p, "HDG 090").ok);
  assert.deepEqual([...p.route], []);
  assert.ok(T.applyCommand(p, "NAV").ok);
  assert.deepEqual([...p.route], ["TUZLA", "MENEK"]);
});

test("separation minima: 3 NM in the TMA, 5 NM en route, same rule for live traffic", () => {
  T.fresh([
    { cs: "A1", x: 10, y: 5, hdg: 90, fl: 60, spd: 250 }, { cs: "B1", x: 10, y: 9, hdg: 90, fl: 60, spd: 250 },
    { cs: "C1", x: -20, y: 5, hdg: 90, fl: 300, spd: 400 }, { cs: "D1", x: -20, y: 9, hdg: 90, fl: 300, spd: 400 },
  ]);
  T.detectConflicts();
  assert.deepEqual(T.levels(), ["C1/D1:CONFLICT"]);

  s.source = "live";
  s.planes = [
    T.makePlane({ live: true, cs: "L1", x: -40, y: 5, hdg: 90, alt: 30000, spd: 400 }),
    T.makePlane({ live: true, cs: "L2", x: -40, y: 9, hdg: 90, alt: 30000, spd: 400 }),
    // both low and close to the airport: parallel approaches are not checked live
    T.makePlane({ live: true, cs: "L3", x: 3, y: -8, hdg: 350, alt: 3000, spd: 160 }),
    T.makePlane({ live: true, cs: "L4", x: 5, y: -8, hdg: 350, alt: 3000, spd: 160 }),
  ];
  T.detectConflicts();
  assert.deepEqual(T.levels(), ["L1/L2:CONFLICT"]);
});

test("live mode: no fictional area alarms, no clutter, no polling while paused", async () => {
  s.source = "live";
  s.log = [];
  s.planes = [T.makePlane({ live: true, cs: "L5", x: -6, y: -21, alt: 5000, spd: 200 })];
  T.run(2);
  assert.equal(s.log.filter((e) => e.type === "AREA").length, 0);
  s.clutter = [{ x: 1, y: 1, b: 0 }];
  T.advanceSweep(5);
  assert.equal(s.clutter.length, 0);
  T.io.fetchCalls = 0;
  s.playing = false;
  await T.fetchLive();
  assert.equal(T.io.fetchCalls, 0);
});

test("scoring: only trajectory clearances count, credited once separated", () => {
  T.fresh([{ cs: "E1", x: -12, y: 0, hdg: 90, fl: 300, spd: 420 }, { cs: "F1", x: 12, y: 0, hdg: 270, fl: 300, spd: 420 }],
    { training: true });
  s.training = true;
  T.detectConflicts();
  T.applyCommand(s.planes[0], "RES");
  assert.ok([...s.pairs.values()].every((r) => !r.commanded));

  T.applyCommand(s.planes[0], "FL 310");
  let dv = null;
  for (let i = 0; i < 400 && !s.score.resolved; i++) {
    T.run(0.25);
    if (s.score.resolved) dv = Math.abs(s.planes[0].alt - s.planes[1].alt);
  }
  assert.equal(s.score.resolved, 1);
  assert.ok(dv >= 1000, `credited at ${dv} ft`);
});

test("scoring: a pair ending because an aircraft leaves is not credited", () => {
  T.fresh([{ cs: "G1", x: 27, y: 0, hdg: 90, fl: 300, spd: 450 }, { cs: "H1", x: 29.3, y: 4, hdg: 180, fl: 300, spd: 450 }]);
  T.detectConflicts();
  T.applyCommand(s.planes[0], "SPD 460");
  T.run(40);
  assert.equal(s.score.resolved, 0);
  assert.ok(!s.log.some((e) => e.type === "RESOLVED"));
});

test("cancelling 7700 restores the original plan", () => {
  T.fresh([{ cs: "K1", x: -10, y: 10, fl: 300, spd: 400, route: ["TUZLA", "MENEK"] }]);
  const p = s.planes[0];
  T.setEmergency(p, "7700");
  assert.equal(p.arrival, true);
  T.clearEmergency(p);
  assert.equal(p.arrival, false);
  assert.deepEqual([...p.route], ["TUZLA", "MENEK"]);
});

test("turning training off keeps vectored arrivals off the ILS", () => {
  T.fresh([{ cs: "M1", x: -15, y: -10, fl: 120, arrival: true }, { cs: "N1", x: 15, y: -10, fl: 120, arrival: true }],
    { training: true });
  T.setTraining(true, false);
  T.applyCommand(s.planes[0], "HDG 090");
  T.setTraining(false, false);
  assert.deepEqual(Array.from(s.planes, (p) => p.ilsCleared), [false, true]);
});

test("FL filter silences alarms for hidden targets", () => {
  let alarms = 0;
  const prev = T.hooks.alarm;
  T.hooks.alarm = () => alarms++;
  s.flMax = 200;
  T.fresh([{ cs: "P1", x: -12, y: 0, hdg: 90, fl: 300, spd: 420 }, { cs: "Q1", x: -9, y: 0, hdg: 90, fl: 300, spd: 420 }]);
  T.detectConflicts();
  assert.equal(alarms, 0);
  s.flMax = 600;
  T.fresh([{ cs: "P2", x: -12, y: 0, hdg: 90, fl: 300, spd: 420 }, { cs: "Q2", x: -9, y: 0, hdg: 90, fl: 300, spd: 420 }]);
  T.detectConflicts();
  assert.equal(alarms, 1);
  T.hooks.alarm = prev;
});

test("scenario export/import keeps vectors and resume routes", () => {
  T.fresh([{ cs: "BAW404", x: 10, y: -5, fl: 290, spd: 400, route: ["RAMOS", "SEDEF"] }]);
  T.applyCommand(s.planes[0], "HDG 120");
  T.loadScenario(JSON.parse(JSON.stringify(T.exportScenario())));
  const p = s.planes[0];
  assert.equal(p.assignedHdg, 120);
  assert.deepEqual([...p.resume.route], ["RAMOS", "SEDEF"]);
  assert.equal(p.controlled, true);
});

test("advisories resolve most conflicts in random traffic", () => {
  let applied = 0, resolved = 0;
  const watch = new Map();
  for (let rep = 0; rep < 4; rep++) {
    T.initRandomTraffic();
    s.training = false;
    for (let k = 0; k < 600; k++) {
      T.run(4, 4);
      for (const c of s.conflicts) {
        const key = T.pairKey(c.a, c.b);
        if (watch.has(key) || c.level !== "TRAFFIC") continue;
        const [a] = T.adviseConflict(c);
        if (!a) { watch.set(key, { done: true }); continue; }
        assert.ok(T.applyCommand(s.planes.find((q) => q.cs === a.cs), a.text).ok);
        if (a.also) assert.ok(T.applyCommand(s.planes.find((q) => q.cs === a.also.cs), a.also.text).ok);
        applied++;
        watch.set(key, {});
      }
      for (const [key, w] of watch) {
        if (w.done) continue;
        const c = s.conflicts.find((x) => T.pairKey(x.a, x.b) === key);
        if (!c) { resolved++; w.done = true; } else if (c.level === "CONFLICT") w.done = true;
      }
    }
    watch.clear();
  }
  assert.ok(applied > 10, `only ${applied} advisories applied`);
  assert.ok(resolved / applied >= 0.9, `${resolved}/${applied} resolved`);
});

test("translations: every English key has a Turkish counterpart and logs follow the language", () => {
  assert.deepEqual(Object.keys(T.I18N.tr).sort(), Object.keys(T.I18N.en).sort());
  T.fresh([{ cs: "Z1", x: 0, y: 20, fl: 300 }]);
  const entry = s.log[s.log.length - 1];
  const en = T.logText(entry);
  T.setLang("tr");
  const tr = T.logText(entry);
  assert.notEqual(en, tr);
  assert.match(T.parseCommand(s.planes[0], "HDG 999").msg, /\S/);
  assert.equal(T.i18n("panel.log"), "OLAY GÜNLÜĞÜ");
});
