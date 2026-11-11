// Loads the browser scripts into a Node VM with minimal DOM/canvas stubs,
// so the simulation can be driven headlessly from tests.
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = ["js/i18n.js", "js/sim.js", "js/render.js", "js/ui.js"];
const EXPORTS = [
  "state", "hooks", "I18N", "i18n", "setLang", "logText", "makePlane", "loadScenario", "exportScenario",
  "initRandomTraffic", "BUILTIN_SCENARIOS", "parseCommand", "applyCommand", "probeCommand",
  "adviseConflict", "pairKey", "buyHint", "detectConflicts", "advanceSweep", "setEmergency",
  "clearEmergency", "setTraining", "fetchLive",
];

function createSim() {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === "measureText") return (s) => ({ width: String(s).length * 6.6 });
      if (typeof k === "string" && k.startsWith("create")) return () => ({ addColorStop: noop });
      return k in t ? t[k] : noop;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const element = () => ({
    textContent: "", innerHTML: "", hidden: false, value: "", dataset: {}, style: {}, className: "",
    classList: { toggle: noop, add: noop, remove: noop },
    addEventListener: noop, closest: () => null, append: noop, click: noop, remove: noop, focus: noop,
    blur: noop, setPointerCapture: noop, files: [], contains: () => false,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 700, height: 700, left: 0, top: 0 }),
  });
  const els = {};
  let frameCb = null;
  const io = { fetchCalls: 0 };
  const sandbox = {
    console, Math, Date, Number, String, Array, Set, Map, Object, JSON, Error, Promise, URL, Blob: class {},
    document: {
      getElementById: (id) => (els[id] ||= element()),
      querySelectorAll: () => [], querySelector: () => element(), createElement: () => element(),
      addEventListener: noop, body: element(), documentElement: {},
    },
    window: { devicePixelRatio: 1, addEventListener: noop },
    localStorage: { getItem: () => null, setItem: noop },
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => { frameCb = cb; },
    fetch: async () => { io.fetchCalls++; return { ok: true, status: 200, json: async () => ({ time: 0, states: [] }) }; },
    setInterval: () => 1, clearInterval: noop, setTimeout: noop,
    ResizeObserver: class { observe() {} },
  };
  vm.createContext(sandbox);
  const src = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  vm.runInContext(`${src}\n;globalThis.__T = { ${EXPORTS.join(", ")} };`, sandbox);

  const T = sandbox.__T;
  let clock = 0;
  /** Advance the main loop by `seconds` of simulated time. */
  T.run = (seconds, speed = 1) => {
    T.state.simSpeed = speed;
    const end = T.state.simTime + seconds;
    while (T.state.simTime < end) {
      clock += 250;
      frameCb(clock);
      for (const p of T.state.planes) for (const k of ["x", "y", "hdg", "alt", "spd", "gs"]) {
        if (!Number.isFinite(p[k])) throw new Error(`${k} is not finite on ${p.cs}`);
      }
    }
  };
  /** Load a scenario without random traffic or weather. */
  T.fresh = (planes, extra = {}) => T.loadScenario({ name: "test", autoSpawn: false, weather: [], planes, ...extra });
  T.levels = () => Array.from(T.state.conflicts, (c) => `${c.a.cs}/${c.b.cs}:${c.level}`).sort();
  T.io = io;
  return T;
}

module.exports = { createSim };
