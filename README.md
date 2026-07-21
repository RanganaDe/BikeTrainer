Simple Bike trainer application for your smart bike with speed sensor

## What this is

BikeTrainer is a smart bike trainer monitoring app that connects to Bluetooth cycling sensors (smart bikes with speed sensors, power meters, or cadence sensors) and displays real-time workout metrics with route tracking and 3D visualization. It logs rides locally and syncs data to Firebase for authenticated users.

### Stack
- **Language:** JavaScript (Vanilla + HTML/CSS)
- **Runtime:** Browser (Client-side only)
- **Backend:** Firebase (Authentication + Firestore)
- **Notable libraries:** 
  - Leaflet (interactive maps for route preview)
  - Three.js (3D ride visualization)
  - Web Bluetooth API (hardware sensor communication)

## How it's organized

```
bike-tracker.html    Main single-file app (~2600 lines)
  ├─ CSS (lines 10-757)
  │   Dark theme (grays/golds), responsive card layout
  │   Power ring visualization, stats grid, 3D canvas
  │
  ├─ HTML (lines 759-882)
  │   Account bar, status indicator, controls
  │   Readouts (power/speed cards), stats tiles
  │   Route inputs, 3D canvas, ride log
  │
  └─ JavaScript (lines 889–end)
    ├─ Sensor connection (Web Bluetooth)
    ├─ Real-time metrics (power, speed, cadence, distance)
    ├─ Route finding (OpenRouteService)
    ├─ 3D ride visualization (Three.js + terrain simulation)
    ├─ Firebase auth & sync
    └─ Local storage (history, settings)
```

**How it fits together:** User connects a Bluetooth sensor → app reads sensor data in real-time and updates power/speed/cadence displays. Optionally enters a route (geocoded start/destination) → fetches route geometry → shows 3D terrain view of the ride as you pedal. Ride data (power, distance, duration, avg metrics) saved locally and optionally synced to Firebase for logged-in users. Route following logic overlays your pedaling progress onto a simulated 3D terrain.

## How to run it

**Single-file app — just open in browser:**
```bash
# Option 1: Serve locally (to avoid CORS issues with route APIs)
python -m http.server 8000
# then visit http://localhost:8000/bike-tracker.html

# Option 2: GitHub Pages (repo has Pages enabled)
# Deploy to GitHub Pages and access via deployed URL
```

**Setup notes:**
- Requires a **Bluetooth-enabled device** with a compatible cycling sensor (trainer, smart bike, or cadence/speed sensors)
- **Firebase config** is embedded in the code (look for `firebaseConfig` in the script)
- **Route finding** uses OpenRouteService API (free tier available, config in code)
- **No installation needed** — it's a single HTML file with embedded CSS and JS
