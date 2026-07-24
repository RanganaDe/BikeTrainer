// Smoke test for Cadence Log (bike-tracker.html).
//
// Loads the app in a headless browser, runs a no-route *simulated* ride through the
// exact same telemetry path a real BLE packet uses, and asserts the core pipeline is
// alive: scripts load, the Three.js 3D view gets a WebGL canvas, live power/speed/cadence
// readouts update, the timer advances, and a finished ride persists to localStorage --
// all with no uncaught JS errors.
//
// It deliberately drives NO route, so it makes zero calls to Nominatim/OSRM/Overpass/
// Open-Meteo and stays deterministic. The only network it needs is the CDN <script>s
// (Three.js / Leaflet / Firebase) the page loads at startup.
//
// Usage: `bash test/run-smoke.sh` (starts the static server for you), or point BASE_URL
// at an already-running server and run `node test/smoke.js`.
//
// Exit code 0 = all checks passed, 1 = a check failed (or the harness itself errored).

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const HEADFUL = process.env.HEADFUL === '1';
const RIDE_SECONDS = 6.5; // must exceed the 5s minimum stopRide() requires to log a ride

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

const num = (t) => { const n = Number(String(t).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : NaN; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    headless: !HEADFUL,
    // swiftshader gives us a real (software) WebGL context in headless chromium.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swapchains',
           '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  // JS-error surface. `pageerror` = uncaught exception (always a real bug). Console
  // "error" that is a failed *resource* load (e.g. an offline CDN font) is noise, not an
  // app bug, so it's tracked separately and doesn't fail the run.
  const jsErrors = [];
  const resourceErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    (/Failed to load resource|net::ERR/i.test(m.text()) ? resourceErrors : jsErrors).push(m.text());
  });

  let fatal = null;
  try {
    await page.goto(`${BASE_URL}/bike-tracker.html`, { waitUntil: 'load', timeout: 30000 });

    // 1) Core scripts wired up: CDN Three.js + the app's shared `els` cache exist.
    // (`els` is a top-level `const`, so it lives in global lexical scope, not on window.)
    await page.waitForFunction(
      () => typeof THREE !== 'undefined' && typeof els !== 'undefined' && els.simulateBtn,
      null, { timeout: 15000 });
    check('page loads: THREE + els present', true);

    // 2) The 3D view initialised a WebGL canvas inside #ride3dCanvas.
    const canvas = await page.evaluate(() => {
      const c = document.querySelector('#ride3dCanvas canvas');
      if (!c) return { ok: false };
      const gl = c.getContext('webgl') || c.getContext('webgl2') || c.getContext('experimental-webgl');
      return { ok: !!gl, w: c.width, h: c.height };
    });
    check('3D view: WebGL canvas present + sized', canvas.ok && canvas.w > 0 && canvas.h > 0,
      canvas.ok ? `${canvas.w}x${canvas.h}` : 'no gl context');

    // Baseline: readouts start as the "–" placeholder, history starts empty-ish.
    const before = await page.evaluate(() => ({
      power: document.getElementById('powerValue').textContent,
      history: (JSON.parse(localStorage.getItem('bike_tracker_history') || '[]')).length,
    }));

    // 3) Start the simulated ride.
    await page.click('#simulateBtn');
    check('simulate: button toggles to "Stop simulation"',
      (await page.textContent('#simulateBtn')).trim().toLowerCase().includes('stop'));

    await sleep(2500); // let several 250ms sim ticks feed telemetry

    // 4) Live readouts are updating with plausible numbers.
    const live = await page.evaluate(() => ({
      power: document.getElementById('powerValue').textContent,
      speed: document.getElementById('speedValue').textContent,
      cadence: document.getElementById('cadenceValue').textContent,
      timer: document.getElementById('timerDisplay').textContent,
    }));
    check('telemetry: power reads a positive number', num(live.power) > 0, `power=${live.power}`);
    check('telemetry: speed reads a positive number', num(live.speed) > 0, `speed=${live.speed}`);
    check('telemetry: cadence reads a positive number', num(live.cadence) > 0, `cadence=${live.cadence}`);
    check('timer: advanced past 00:00', live.timer.trim() !== '00:00', `timer=${live.timer}`);

    // Keep riding so total duration clears the 5s log threshold, then stop.
    await sleep(Math.max(0, RIDE_SECONDS * 1000 - 2500));
    await page.click('#simulateBtn');
    await sleep(500);

    // 5) The finished ride was logged to localStorage.
    const after = await page.evaluate(() => {
      const h = JSON.parse(localStorage.getItem('bike_tracker_history') || '[]');
      return { count: h.length, last: h[h.length - 1] || null };
    });
    const gained = after.count === before.history + 1;
    check('persistence: ride logged to localStorage', gained,
      after.last ? `entries=${after.count}, dur=${after.last.duration}s, avgPower=${after.last.avgPower}W` : `entries=${after.count}`);
    if (after.last) check('persistence: logged ride has sane fields',
      after.last.duration >= 5 && after.last.avgPower > 0);

    check('button: returns to "Simulate ride" after stop',
      (await page.textContent('#simulateBtn')).trim().toLowerCase().includes('simulate'));
  } catch (e) {
    fatal = e;
  }

  // 6) No uncaught JS errors at any point.
  check('no uncaught JS errors', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 3).join(' | ') : '');
  if (resourceErrors.length) console.log(`  ℹ ${resourceErrors.length} resource load error(s) ignored (CDN/offline noise)`);

  await browser.close();

  if (fatal) { console.error('\nHARNESS ERROR:', fatal.message); process.exit(1); }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${failed.length ? '✗ FAIL' : '✓ PASS'}  ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });