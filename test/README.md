# Smoke test

A single headless-browser check that the core ride pipeline still works end to end. It
loads `bike-tracker.html`, runs a **simulated ride** (no sensor, no route), and asserts:

- the page loads with Three.js + the shared `els` cache present (no uncaught JS errors),
- the 3D view creates a sized WebGL canvas,
- live **power / speed / cadence** readouts update with plausible numbers,
- the ride **timer** advances,
- a finished ride (>5s) is **logged to `localStorage`**.

It drives no route, so it never calls Nominatim / OSRM / Overpass / Open-Meteo and is fully
deterministic. The only network it needs is the CDN `<script>`s the page loads at startup
(Three.js / Leaflet / Firebase).

This is the app's only automated test. The app stays build-free — this `test/` folder is the
only place with a `package.json` / `node_modules`, and none of it ships with the app.

## Run it

```bash
bash test/run-smoke.sh
```

The runner starts the static server for you, runs the checks, and exits non-zero if any fail.

Options:

```bash
PORT=8123 bash test/run-smoke.sh     # use a different port
HEADFUL=1 bash test/run-smoke.sh     # watch it in a real browser window
```

## First-time setup

The runner reuses a globally cached Playwright if it can find one. If it can't, install it here:

```bash
cd test
npm install
npx playwright install chromium
```