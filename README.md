# ATC Radar Simulator

A browser-based air traffic control radar simulator around Istanbul Airport (LTFM), with an optional
live mode that shows real aircraft from the OpenSky Network.

The interface is in English; a Turkish translation can be selected with the **EN · TR** button in the
top-right corner (the choice is remembered). Aviation phraseology (HDG, FL, readbacks) stays English.

## Running

```sh
npm start        # same as: node server.js
```

Then open http://localhost:8080 (Node 18+, no dependencies).

- `PORT=3000 node server.js` — different port
- `HOST=0.0.0.0 node server.js` — reachable from the local network. By default the server only listens on
  this computer, because everyone who can reach it shares the OpenSky daily quota.

`server.js` serves the static files and proxies the OpenSky API for **live mode** (OpenSky does not allow
direct browser calls from other origins). Without live mode the page also works from any static server.

The GitHub Pages build of this repository is such a static copy: everything except live mode works there.

## Tests

```sh
npm test
```

The tests load the browser scripts into a Node VM with DOM stubs (`test/harness.js`) and check commands,
separation rules, scoring, emergencies, scenario round-trips, advisories and translations. GitHub Actions
runs them on every push; pushes to `main` are then deployed to GitHub Pages
(`.github/workflows/pages.yml`).

## Files

| File | Contents |
|---|---|
| `js/i18n.js` | English and Turkish texts, language switching |
| `js/sim.js` | World model: traffic, navigation, ILS, wind, weather, conflict detection, conflict probe and advisories, scoring, recording, scenarios (no DOM code) |
| `js/render.js` | Canvas drawing: scope, map, areas, weather, targets, label placement, clearance preview, ruler |
| `js/ui.js` | Panels, controls, commands, live data, sound, main loop |
| `server.js` | Static server + OpenSky proxy for live mode |
| `test/` | Headless tests (`node --test`) |

## Clearances

Select a target and use the **CLEARANCE** panel, or press `/` for the command line:

| Command | Example | Meaning |
|---|---|---|
| `HDG n` | `HDG 270` | Fly heading (leaves the route) |
| `FL n` | `FL 240` | Climb/descend |
| `SPD n` | `SPD 280` | Assign speed |
| `DCT FIX` | `DCT TUZLA` | Direct to fix |
| `NAV` | `NAV` | Resume own navigation (route / ILS clearance held before vectoring) |
| `ILS` | `ILS` | Cleared ILS 35L via KOPRU |
| `RES` | `RES` | Resume normal speed (a speed assigned on final is cancelled automatically at 4 NM) |

Commands can be combined: `HDG 090 FL 300 SPD 320`. An aircraft squawking 7600 (radio failure) does not answer.
Cancelling a 7700 with **NORMAL** returns the aircraft to its original plan unless it is already on the localizer.

**Vectoring on the scope:** press on the *selected* target and drag. The pointer marks the desired track; the
wind-corrected heading (rounded to 5°) is shown and issued on release. `Esc` cancels.

**Clearance preview (conflict probe):** while typing a clearance, dragging a heading or hovering an advisory,
the aircraft's 4-minute forecast path is drawn dashed on the scope (one mark and FL per minute). If it loses
separation with someone, the line turns amber, the point is marked with a red ✕, and the panel says
"conflict with X in 1:20".

**Resolution advisories:** up to three advisories appear under each conflict in **CONFLICT ANALYSIS**: a level
change, a 20–60° turn, speed control, breaking off the approach (`HDG … FL …`), or a vertical split of both
aircraft (`A FL190 + B FL170`). Each one must keep the pair 0.5 NM beyond the minimum for 4 minutes without
creating a new conflict. Click to apply. In training mode they are hidden; **HINT** reveals them for 25 points.

## Separation and scoring

- Minima: 1000 ft vertical; 5 NM horizontal en route, 3 NM when both aircraft are inside the TMA
  (below 10,000 ft within 25 NM of LTFM). The same rules apply to simulated and live traffic.
- Not checked: runway operations (tower), and in live mode pairs that are both below 6,000 ft within 20 NM
  (the real airport's independent parallel runways cannot be represented by the single-runway model).
- Score is kept only in training mode: +100 for a conflict resolved by a trajectory clearance
  (HDG/FL/SPD/DCT/NAV), credited once the aircraft are vertically separated or diverging; −150 per separation
  loss; −100 per restricted-area infringement; +50 per landing; −25 per hint. A pair that ends because an
  aircraft leaves the sector or lands scores nothing.
- The FL filter hides targets everywhere (scope, list, conflict panel, SYS status, alarms); they are still
  separated and scored.

## Live mode

**SOURCE: LIVE** shows real aircraft within 60 NM of LTFM from OpenSky, polled every 15 s (anonymous access
allows about 400 requests a day, i.e. roughly 100 minutes of live mode). Polling stops while paused.
Each position is extrapolated to the response time; fixes older than 60 s are dropped.
The fixes, airways and restricted areas are fictional; areas, weather and ground clutter are therefore not
shown or checked in live mode.

## Shortcuts

`Space` pause/play · `R` ruler · `M` sound · `1–5` range (5/10/15/30/60 NM) · `/` command line ·
`Esc` cancel drag / close ruler / leave replay / deselect

## Scenario format

Create one with **SAVE** and open it with **LOAD…**; **↻** restarts the selected scenario, including a loaded file.

```json
{
  "name": "Example",
  "wind": { "dir": 270, "spd": 15 },
  "training": false,
  "autoSpawn": true,
  "weather": [{ "x": -10, "y": 5, "r": 3 }],
  "planes": [
    { "cs": "THY101", "type": "A321", "x": -6, "y": 7, "fl": 330, "spd": 400, "route": ["TUZLA", "MENEK"] },
    { "cs": "KLM505", "x": -20, "y": -12, "fl": 140, "arrival": true },
    { "cs": "DLH707", "x": 15, "y": 14, "fl": 280, "squawk": "7700" },
    { "cs": "AFR606", "x": 2, "y": 4, "fl": 60, "targetFl": 200, "departureExit": "NIKEL" },
    { "cs": "BAW404", "x": 10, "y": -5, "fl": 290, "assignedHdg": 120, "resume": ["RAMOS", "SEDEF"], "controlled": true },
    { "primary": true, "x": -14, "y": -19, "fl": 35, "spd": 110, "hdg": 90 }
  ]
}
```

Positions are in nautical miles from LTFM (x = east, y = north). Fixes: ERKAL, BOSRA, TUZLA, MENEK, NIKEL,
RAMOS, VEDAT, OLMAK, PELIT, SEDEF, KOPRU.

The fix, airway and area names in the simulation are fictional and do not represent real Istanbul airspace;
live aircraft data comes from the OpenSky Network.
