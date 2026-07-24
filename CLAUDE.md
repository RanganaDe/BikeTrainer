# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page, client-side-only bike trainer app ("Cadence Log"). It connects to Bluetooth cycling sensors via the Web Bluetooth API, shows live power/speed/cadence, follows a real-world route, renders a Three.js 3D ride view, logs rides to `localStorage`, and optionally syncs to Firebase for signed-in users.

There is **no build system, no bundler, and no linter config** for the app itself — everything is vanilla HTML/CSS/JS served as static files. The only exception is `test/`, a self-contained headless smoke test (its own `package.json`, not shipped with the app — see Testing below).

The end goal is to have a 3D visualisation ready for the selected bike ride, where the 3D visual is almost close to real environment. 

## Running it

```bash
# Serve statically (needed — file:// breaks the route/geocoding fetches and CORS)
python -m http.server 8000
# then open http://localhost:8000/bike-tracker.html
```

- Web Bluetooth requires **Chrome/Edge on desktop or Android**, or **Bluefy** on iOS/iPadOS (Apple blocks Web Bluetooth in all iOS browsers — see the banner logic in `js/diagnostics.js`).
- **No sensor needed to test most things:** the "Simulate ride" button feeds fake telemetry through the exact same `updateSpeed/updatePower/updateCadence` path a real BLE packet uses, so the 3D view, stats, ride log, and cloud sync all behave identically. Use this for any change not specific to BLE parsing.
- On-device debugging: `bike-tracker.html` has an inline on-page error console (top of `<head>`) that surfaces JS errors on screen, for browsers like Bluefy with no dev tools. The ▤ button opens a raw BLE packet log.

## Testing

```bash
bash test/run-smoke.sh          # starts the server, runs the checks, tears down; exit 0 = pass
```

`test/smoke.js` is a headless Playwright smoke test — the app's one automated safety net. It
loads the page, runs a **no-route simulated ride**, and asserts the core pipeline is alive:
scripts load with no uncaught JS errors, the 3D view gets a WebGL canvas, live
power/speed/cadence readouts update, the timer advances, and a finished ride persists to
`localStorage`. Because it drives no route it calls no external data services (Nominatim/OSRM/
Overpass/Open-Meteo) and is deterministic; it only needs the CDN `<script>`s at page load.

Run it after any change with a runtime surface (telemetry, ride lifecycle, 3D init, history).
It uses swiftshader for headless WebGL and reuses a globally-cached Playwright if present
(else `cd test && npm install && npx playwright install chromium`). It is **not** a substitute
for on-device checks of the 3D visuals — swiftshader lighting/geometry only approximates a real
GPU (see the terrain-verification notes in `memory/`).

## Critical architecture constraint: one shared global scope

The app was refactored out of a single IIFE into separate files in `js/`, but they are **still plain classic `<script>` tags, not ES modules.** They all share one global scope. This has hard consequences:

- **Load order matters and is fixed** by the `<script>` tags at the bottom of `bike-tracker.html`. Each file assumes everything above it has already run. Current order: `dom.js` → `history.js` → `cloud-sync.js` → `diagnostics.js` → `telemetry.js` → `route-region.js` → `route.js` → `ride3d.js` → `ble.js` → `share.js` → `ride-session.js`.
- **Functions and `let`/`const` state defined in one file are called directly by others** — there are no imports/exports. E.g. `ble.js` calls `updateSpeed()` (in `telemetry.js`) and `stopRide()` (in `ride-session.js`); `route.js` calls `build3DRoute()` (in `ride3d.js`); everything reads `els` (in `dom.js`).
- When adding cross-file calls, guard optional dependencies (the code does this with patterns like `if(build3DRoute) build3DRoute(...)` and `if(els.hudTime)`).
- Do **not** introduce `import`/`export`, `type="module"`, or a bundler without converting the whole set — it will break the shared-scope assumption.

## File responsibilities

| File | Role |
|------|------|
| `bike-tracker.html` | All markup + all CSS (inline `<style>`). CDN scripts (Leaflet, Three.js 0.128, Firebase compat) load before local scripts. |
| `js/dom.js` | The `els` object (cached `getElementById` refs, used everywhere), `escapeHtml`, power-ring constants. |
| `js/telemetry.js` | Core live-metric state (`lastPower/lastSpeed/lastCadence`, ride flags) and the `updateX()` functions that write to the DOM. This is the hub the sensor layer and simulator both feed. |
| `js/ble.js` | Web Bluetooth: connection, and parsers for FTMS indoor bike data (0x2AD2), Cycling Power (0x2A63), and CSC (0x2A5B, speed fallback via wheel circumference). Uses explicit SIG UUIDs (not Chrome short names) for Bluefy compatibility. |
| `js/ride-session.js` | Start/pause/resume/stop ride lifecycle, timer, avg/max power accumulation, and the fake-telemetry **simulator**. On stop, builds the ride entry and persists it. |
| `js/route.js` | Geocoding (Nominatim), routing (OSRM `router.project-osrm.org`, bike profile), street-name timeline from OSRM steps, POI + landcover fetch (Overpass), road elevation (Open-Meteo), and route progress. Landcover uses Overpass `out count` (tallies only, no geometry) and is cached per route; POI/elevation/landcover all re-detect the region and rebuild the scene when they land. Holds `routeCoords/routeActive/routeTotalKm` etc. |
| `js/route-region.js` | Pure, data-driven biome builder. `detectRegion(coords, elevProfile, landcover)` composes a "region profile" for any route on Earth from latitude → climate band (palette + scenery), elevation relief → `elevationScale`/`mountains`, and OSM landcover counts → forest/farmland/arid scenery mix. `ride3d.js` reads the returned `palette`/`scenery`/`elevationScale`/`mountains` (never the profile name). `REGION_PROFILES.generic` remains as the pre-route / no-data fallback and equals the temperate band. |
| `js/ride3d.js` | Largest file (~2000 lines). Three.js scene: terrain mesh, road ribbon, cyclist avatar + chase camera, rival cyclist, POIs, time-of-day lighting, minimap. Reads live `lastSpeed/lastCadence` each animation frame. |
| `js/history.js` | `localStorage` ride log (`bike_tracker_history`), wheel-size setting, and rendering the ride list. |
| `js/cloud-sync.js` | Firebase Auth (Google) + Firestore. Merges local and cloud rides by timestamp on sign-in. Config is embedded; `cloudConfigured` gates the UI. |
| `js/share.js` | Renders a ride to an Instagram-story-sized PNG canvas and shares/downloads it. |
| `js/diagnostics.js` | On-screen debug packet log, copy-to-clipboard, and browser-support / iOS-detection banner. |

## Data flow (the mental model)

1. **BLE packet** (`ble.js`) or **simulator tick** (`ride-session.js`) → calls `updateSpeed/updatePower/updateCadence` (`telemetry.js`).
2. `telemetry.js` updates the DOM readouts + HUD, accumulates distance/avg-power while `isRiding && !isPaused`, and if a route is active calls `updateRouteProgress()` (`route.js`).
3. The Three.js `animate()` loop (`ride3d.js`) independently reads `lastSpeed`/`lastCadence`/ride flags every frame to drive the avatar and camera down the route ribbon.
4. On `stopRide()`, the ride entry is written to `localStorage` (`history.js`) and, if signed in, pushed to Firestore (`cloud-sync.js`).

## External services (all client-side, no keys except Firebase)

- **Nominatim** — geocoding start/destination.
- **OSRM** (`router.project-osrm.org`) — cycling route geometry + turn-by-turn steps.
- **Overpass** — roadside POIs. Endpoint fallbacks and throttling matter; a `building=yes` catch-all previously caused chronic 504s (see project memory).
- **Open-Meteo elevation** — road/terrain elevation, heavily throttled (100 coords/call, ~6-call burst window; requests are chained sequentially and cached in `localStorage` under `bt_elev_*`).
- **Firebase** — Auth + Firestore, config embedded in `js/cloud-sync.js`.

When touching the elevation, POI, or region/terrain code, check the notes in the auto-memory index (`memory/MEMORY.md`) first — several hard-won constraints and an unverified terrain camera fix are recorded there.