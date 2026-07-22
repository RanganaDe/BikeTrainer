		// ---------- route / virtual ride map ----------
		let map = null, routeLayer = null, riderMarker = null;
		let routeCoords = [];   // [{lat, lng}, ...] along the route
		let routeCumDist = [];  // cumulative km at each coordinate
		let routeTotalKm = 0;
		let routeActive = false;
		let followRider = true;
		let routeFromLabel = '', routeToLabel = '';
		let routeStreetSegments = []; // [{name, fromKm, toKm}, ...] built from OSRM's turn-by-turn steps
		let routePOIs = []; // [{lat, lng, kind, name}, ...] fetched from OpenStreetMap via Overpass
		let routeElevationKm = []; // cumulative km at each elevation sample -- parallel to routeElevationM
		let routeElevationM = []; // elevation in metres at each sample, from Open-Elevation

		// Bridged into by init3D() once it runs, so findRoute() (defined here, outside
		// the 3D closure) can hand real route coordinates to the 3D scene.
		let build3DRoute = null;
		let clear3DRoute = null;
		let place3DPOIs = null;
		let apply3DRegion = null; // hands a detected region profile to the 3D scene
		let apply3DTerrain = null; // hands a sampled DEM corridor to the 3D scene

		let region = null; // detected geographic region profile for the active route (see route-region.js)
		let routeTerrain = null; // sampled surrounding-terrain heightfield for the active route (see fetchRouteTerrain)

		function haversineKm(a, b) {
			const R = 6371;
			const dLat = (b.lat - a.lat)*Math.PI/180;
			const dLng = (b.lng - a.lng)*Math.PI/180;
			const la1 = a.lat*Math.PI/180, la2 = b.lat*Math.PI/180;
			const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
			return 2*R*Math.asin(Math.sqrt(h));
		}

		function downsampleCoords(coords, maxPoints) {
			if(coords.length <= maxPoints) return coords.slice();
			const step = coords.length/maxPoints;
			const out = [];
			for(let i = 0; i < maxPoints; i++) {
				out.push(coords[Math.floor(i*step)]);
			}
			out.push(coords[coords.length - 1]);
			return out;
		}

		// ---------- nearby points of interest (OpenStreetMap via Overpass) ----------
		// Fetched after the route itself so a slow/rate-limited Overpass request
		// never blocks the core "find route and ride it" flow -- see the .then()
		// in findRoute() below, which places these once they resolve.
		//
		// This used to split the route into many small "around"-filtered chunks to
		// avoid wasting a bbox fetch's result cap on land nowhere near the road.
		// In practice that made things worse: one request per ~2km of route meant
		// a single "find route" could fire a dozen+ sequential calls, and the free
		// public Overpass instance rate-limits on request COUNT, not just size --
		// so chunking tripped 429s far more reliably than it avoided them. A single
		// bbox request is one call no matter how long the route is. It does waste
		// some of its result cap on off-route land, but placeRoutePOIs() in
		// ride3d.js already re-filters every result by real distance to the route
		// before rendering anything, so that waste costs cap headroom, not correctness.
		const POI_MATCH_RADIUS_M = 90; // must match placeRoutePOIs()' own filter radius in ride3d.js

		function routeBBoxPadded(coords, padMeters) {
			const lats = coords.map(c => c.lat), lngs = coords.map(c => c.lng);
			const minLat = Math.min(...lats), maxLat = Math.max(...lats);
			const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
			const midLat = (minLat + maxLat)/2*Math.PI/180;
			const padLat = padMeters/110574;
			const padLng = padMeters/(111320*Math.cos(midLat));
			return {
				south: minLat - padLat, west: minLng - padLng,
				north: maxLat + padLat, east: maxLng + padLng
			};
		}

		function overpassElementToPOI(el) {
			const lat = el.type === 'node' ? el.lat : (el.center && el.center.lat);
			const lng = el.type === 'node' ? el.lon : (el.center && el.center.lon);
			if(lat == null || lng == null) return null;
			const tags = el.tags || {};
			let kind = 'house';
			if(tags.amenity === 'hospital') kind = 'hospital';
			else if(tags.amenity === 'school') kind = 'school';
			else if(tags.amenity === 'fuel') kind = 'fuel';
			else if(tags.amenity === 'place_of_worship') kind = 'church';
			else if(tags.railway === 'station') kind = 'station';
			else if(tags.shop) kind = 'shop';
			else if(tags.leisure === 'playground') kind = 'playground';
			else if(tags.leisure === 'park') kind = 'park';
			else if(tags.man_made === 'windmill') kind = 'windmill';
			return {lat, lng, kind, name: tags.name || null};
		}

		function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

		// The default overpass-api.de instance is chronically overloaded and 504s on
		// anything non-trivial, so try a list of mirrors in turn -- osm.ch answers this
		// query in well under a second. All three send `Access-Control-Allow-Origin: *`,
		// so they work from the browser.
		const OVERPASS_ENDPOINTS = [
			'https://overpass.osm.ch/api/interpreter',
			'https://overpass-api.de/api/interpreter',
			'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
		];

		async function fetchPOIRequest(bboxStr) {
			// The old query pulled every `building=yes` in the whole route bbox -- tens of
			// thousands of generic footprints -- which is exactly what timed Overpass out.
			// Requesting only explicitly-typed residential buildings keeps the real houses
			// while dropping that catch-all, turning a 504 into a sub-second response.
			const query = `[out:json][timeout:25];(
				node["amenity"~"^(hospital|school|fuel|place_of_worship)$"](${bboxStr});
				way["amenity"~"^(hospital|school|fuel|place_of_worship)$"](${bboxStr});
				node["railway"="station"](${bboxStr});
				way["railway"="station"](${bboxStr});
				node["shop"~"^(supermarket|bakery|convenience)$"](${bboxStr});
				way["shop"~"^(supermarket|bakery|convenience)$"](${bboxStr});
				node["leisure"~"^(park|playground)$"](${bboxStr});
				way["leisure"~"^(park|playground)$"](${bboxStr});
				node["man_made"="windmill"](${bboxStr});
				way["man_made"="windmill"](${bboxStr});
				way["building"~"^(house|residential|detached|semidetached_house|terrace)$"](${bboxStr});
			);out center 3000;`;

			let lastErr;
			for(const endpoint of OVERPASS_ENDPOINTS) {
				try {
					const res = await fetch(endpoint, {method: 'POST', body: 'data=' + encodeURIComponent(query)});
					if(!res.ok) {
						const err = new Error(`Overpass request failed (${res.status})`);
						const retryAfter = Number(res.headers.get('Retry-After'));
						if(!Number.isNaN(retryAfter)) err.retryAfterMs = retryAfter*1000;
						throw err;
					}
					const data = await res.json();
					return data.elements;
				} catch(e) {
					lastErr = e;
					console.warn(`Overpass mirror failed (${endpoint}): ${e.message}`); // fall through to the next mirror
				}
			}
			throw lastErr || new Error('All Overpass mirrors failed');
		}

		async function fetchRoutePOIs(coords) {
			const bbox = routeBBoxPadded(coords, POI_MATCH_RADIUS_M + 60);
			const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

			let elements;
			try {
				elements = await fetchPOIRequest(bboxStr);
			} catch(e) {
				// A single retry, honoring Retry-After if the server sent one --
				// this is now the ONLY Overpass call this feature makes per route,
				// so one polite retry is proportionate; no chunk loop to bail out of.
				const delay = e.retryAfterMs || 5000;
				console.error(`Overpass request failed, waiting ${delay}ms before retrying:`, e);
				await sleep(delay);
				try {
					elements = await fetchPOIRequest(bboxStr);
				} catch(e2) {
					logEvent('route', `Could not load nearby places from OpenStreetMap (Overpass may be busy): ${e2.message}`);
					return [];
				}
			}

			return elements.map(overpassElementToPOI).filter(Boolean);
		}

		// ---------- road elevation (Open-Elevation) ----------
		// Same lesson as the Overpass POI fetch above: one request for the whole
		// route, not one per segment -- a free public API call per route is fine,
		// a free public API call every few hundred metres is how you get rate-limited.
		function sampleRouteByDistance(spacingKm, maxPoints) {
			const count = Math.min(maxPoints, Math.max(2, Math.ceil(routeTotalKm/spacingKm) + 1));
			const step = routeTotalKm/(count - 1);
			const out = [];
			for(let i = 0; i < count; i++) {
				const km = step*i;
				out.push({km, ...latLngAtKm(km)});
			}
			return out;
		}

		// Elevation now comes from Open-Meteo rather than Open-Elevation: the public
		// Open-Elevation instance frequently times out on the larger requests a long
		// route needs (so the 3D road silently stayed flat), whereas Open-Meteo is
		// reliable, CORS-enabled, key-free, and returns the same DEM values. It's a GET
		// with comma-joined lat/lng lists, hard-capped at 100 coords per call.
		const OPEN_METEO_BATCH = 100;

		// Open-Meteo rate-limits on BURSTS, so EVERY elevation call (the road profile AND
		// the larger terrain corridor) funnels through one global promise chain that runs
		// them strictly one-at-a-time with a small gap. Firing them in parallel (the
		// original bug) drew a storm of 429s, which null-filled into flat shelves in the
		// road and terrain. Each call retries a few times on 429 with back-off.
		let openMeteoChain = Promise.resolve();
		const OPEN_METEO_GAP_MS = 300; // Open-Meteo's burst window fits ~6 quick calls; stay comfortably under it
		function throttledElevationJson(url) {
			const run = async () => {
				for(let attempt = 0; attempt < 4; attempt++) {
					const res = await fetch(url);
					if(res.status === 429) {
						const ra = Number(res.headers.get('Retry-After'));
						await sleep(!Number.isNaN(ra) && ra > 0 ? ra*1000 : 700*(attempt + 1));
						continue;
					}
					if(!res.ok) throw new Error(`elevation HTTP ${res.status}`);
					return res.json();
				}
				throw new Error('elevation HTTP 429 (retries exhausted)');
			};
			const result = openMeteoChain.then(run, run); // stay chained even if a prior call rejected
			openMeteoChain = result.then(() => sleep(OPEN_METEO_GAP_MS), () => sleep(OPEN_METEO_GAP_MS));
			return result;
		}

		// Runs batches sequentially via the throttle above. One failed batch shouldn't
		// sink the whole profile -- its points stay null and cleanElevation()/fillNulls
		// patch them.
		async function fetchOpenMeteoElevations(points) {
			const out = new Array(points.length).fill(null);
			for(let start = 0; start < points.length; start += OPEN_METEO_BATCH) {
				const slice = points.slice(start, start + OPEN_METEO_BATCH);
				const lat = slice.map(p => p.lat.toFixed(5)).join(',');
				const lng = slice.map(p => p.lng.toFixed(5)).join(',');
				try {
					const data = await throttledElevationJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
					const elev = data.elevation || [];
					for(let j = 0; j < slice.length; j++) out[start + j] = (typeof elev[j] === 'number') ? elev[j] : null;
				} catch(e) {
					console.error('Open-Meteo elevation batch failed:', e); // leaves this batch's points null
				}
			}
			return out;
		}

		// The free Open-Elevation API occasionally returns junk samples -- nulls, or a
		// single point off by hundreds of metres -- and since samples are ~150m apart
		// and get exaggerated by the region's elevationScale, one bad sample becomes a
		// deep V-shaped pit in the 3D road (the "road sinks and reappears" artefact) and
		// a bogus resistance spike. Clean the raw array before anyone uses it:
		//   1. Replace non-finite values by linear interpolation of the nearest valid
		//      neighbours (0 is left alone -- it's real sea level in e.g. the Netherlands).
		//   2. Median-of-3 filter: an isolated sample that jumps far from BOTH neighbours
		//      is a spike, not terrain (a genuine climb moves its neighbours too), so
		//      replace it with the local median. Real sustained grades are untouched.
		function cleanElevation(raw) {
			const n = raw.length;
			const a = raw.map(v => (typeof v === 'number' && isFinite(v)) ? v : null);
			for(let i = 0; i < n; i++) {
				if(a[i] !== null) continue;
				let p = i - 1; while(p >= 0 && a[p] === null) p--;
				let q = i + 1; while(q < n && a[q] === null) q++;
				if(p < 0 && q >= n) a[i] = 0;
				else if(p < 0) a[i] = a[q];
				else if(q >= n) a[i] = a[p];
				else a[i] = a[p] + (a[q] - a[p])*((i - p)/(q - p));
			}
			const out = a.slice();
			const SPIKE_M = 20; // >20m jump over ~150m (~13% grade) that reverses = spike, not a real climb
			for(let i = 1; i < n - 1; i++) {
				const med = [a[i-1], a[i], a[i+1]].sort((x, y) => x - y)[1];
				if(Math.abs(a[i] - med) > SPIKE_M) out[i] = med;
			}
			return out;
		}

		async function fetchRouteElevation() {
			const samples = sampleRouteByDistance(0.15, 100); // one Open-Meteo call; smoothing covers the coarser spacing on long routes
			const elev = await fetchOpenMeteoElevations(samples.map(s => ({lat: s.lat, lng: s.lng})));
			if(elev.every(v => v == null)) {
				logEvent('route', 'Could not load elevation data (Open-Meteo unreachable)');
				return null;
			}
			return {
				km: samples.map(s => s.km),
				elevM: cleanElevation(elev),
			};
		}

		// Destination lat/lng from a start point, a compass bearing, and a distance in
		// metres (standard great-circle formula; negative distance goes the opposite way).
		function destinationPoint(lat, lng, bearingDeg, distM) {
			const R = 6371000;
			const d = distM/R, th = bearingDeg*Math.PI/180;
			const p1 = lat*Math.PI/180, l1 = lng*Math.PI/180;
			const sinP2 = Math.sin(p1)*Math.cos(d) + Math.cos(p1)*Math.sin(d)*Math.cos(th);
			const p2 = Math.asin(sinP2);
			const l2 = l1 + Math.atan2(Math.sin(th)*Math.sin(d)*Math.cos(p1), Math.cos(d) - Math.sin(p1)*sinP2);
			return {lat: p2*180/Math.PI, lng: l2*180/Math.PI};
		}

		// Grid-fill: replace nulls by carrying the nearest valid value forward then
		// backward, so a dropped DEM sample never leaves a hole. (Terrain keeps its
		// sharp real features -- unlike the road profile, spikes here are mountains.)
		function fillNulls(arr) {
			const out = arr.slice();
			let last = null;
			for(let i = 0; i < out.length; i++) { if(out[i] != null) last = out[i]; else if(last != null) out[i] = last; }
			for(let i = out.length - 1; i >= 0; i--) { if(out[i] != null) last = out[i]; else if(last != null) out[i] = last; }
			return out.map(v => v == null ? 0 : v);
		}

		// ---------- surrounding terrain (DEM corridor) ----------
		// Samples a real elevation heightfield in a band that FOLLOWS the route: at
		// stations along the path, a fan of lateral points reaching HALF_WIDTH_M to each
		// side, perpendicular to travel. This keeps terrain resolution constant no matter
		// how long the route is (a bbox grid would be uselessly coarse on a 200km route),
		// puts the road down the centre column so it rests in its real valley, and gives
		// the rider actual mountainsides rising around them. Same Open-Meteo source and
		// non-blocking treatment as the road elevation profile.
		async function fetchRouteTerrain() {
			if(routeTotalKm <= 0) return null;
			// Open-Meteo caps at 100 coords/call and rate-limits bursts, so the corridor
			// is kept to a few hundred samples total (~3-6 sequential calls). Lateral
			// resolution (the valley cross-section that reads as walls) is prioritised;
			// along-route stations are coarser and the mesh interpolates between them.
			const HALF_WIDTH_M = 350; // terrain reaches ~350m each side of the road
			const COLS = 13;          // lateral samples per station (~58m apart)
			// Cap at 30 stations -> <=390 samples -> 4 terrain calls; with the 1-call road
			// profile that's <=5 Open-Meteo calls per route, under the ~6-call burst limit.
			const stations = Math.min(30, Math.max(8, Math.round(routeTotalKm*1000/250)));

			const pts = [];
			for(let s = 0; s < stations; s++) {
				const km = routeTotalKm*(s/(stations - 1));
				const center = latLngAtKm(km);
				const ahead = latLngAtKm(Math.min(km + 0.02, routeTotalKm));
				let brg = bearingDeg(center, ahead);
				if(!isFinite(brg)) brg = 0;
				const perp = brg + 90;
				for(let c = 0; c < COLS; c++) {
					const off = -HALF_WIDTH_M + (2*HALF_WIDTH_M)*(c/(COLS - 1));
					pts.push(destinationPoint(center.lat, center.lng, perp, off));
				}
			}

			const elev = await fetchOpenMeteoElevations(pts);
			if(elev.every(v => v == null)) {
				logEvent('route', 'Could not load surrounding terrain (Open-Meteo unreachable)');
				return null;
			}
			return {
				stations, cols: COLS, halfWidthM: HALF_WIDTH_M,
				lat: pts.map(p => p.lat),
				lng: pts.map(p => p.lng),
				elev: fillNulls(elev),
			};
		}

		function initMap() {
			if(map) return;
			map = L.map('routeMap');
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
			}).addTo(map);
			map.setView([52.2, 5.5], 6);
		}

		// Small mirror map shown in the Ride view's corner while riding a route --
		// same route line/rider position as the main map, just compact and always
		// visible without scrolling down to the Route section.
		let miniMap = null, miniRouteLayer = null, miniRiderMarker = null;
		function initMiniMap() {
			if(miniMap) return;
			miniMap = L.map('miniMap', {
				zoomControl: false, attributionControl: false, dragging: false,
				scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false
			});
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);
			miniMap.setView([52.2, 5.5], 6);
		}

		async function geocode(query) {
			const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
			if(!res.ok) throw new Error('Geocoding request failed');
			const data = await res.json();
			if(!data.length) throw new Error(`Location not found: "${query}"`);
			return {lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name};
		}

		async function findRoute() {
			const fromQ = els.routeFrom.value.trim();
			const toQ = els.routeTo.value.trim();
			if(!fromQ || !toQ) {
				els.routeStatus.textContent = 'Enter a start and destination.';
				return;
			}
			initMap();
			els.findRouteBtn.disabled = true;
			els.routeStatus.textContent = 'Looking up locations…';
			if(els.streetNameLabel) els.streetNameLabel.classList.remove('show');
			try {
				const [from, to] = await Promise.all([geocode(fromQ), geocode(toQ)]);

				els.routeStatus.textContent = 'Fetching route…';
				const url = `https://router.project-osrm.org/route/v1/bike/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
				const res = await fetch(url);
				if(!res.ok) {
					// OSRM returns a JSON body with its own reason even on 4xx/5xx (e.g.
					// {"code":"InvalidValue",...}) -- surface that instead of a bare
					// "failed", since a flat 400 alone doesn't say which point was bad.
					let detail = '';
					try { detail = (await res.json()).message || ''; } catch(e) {}
					throw new Error(`Routing request failed (${res.status})${detail ? ': ' + detail : ''}`);
				}
				const data = await res.json();
				if(data.code && data.code !== 'Ok') throw new Error(data.message || `Routing failed: ${data.code}`);
				if(!data.routes || !data.routes.length) throw new Error('No cycling route found between those points.');

				const coords = data.routes[0].geometry.coordinates.map(c => ({lat: c[1], lng: c[0]}));
				routeCoords = coords;
				routeCumDist = [0];
				for(let i = 1; i < coords.length; i++) {
					routeCumDist.push(routeCumDist[i - 1] + haversineKm(coords[i - 1], coords[i]));
				}
				routeTotalKm = routeCumDist[routeCumDist.length - 1];
				routeActive = true;
				routeFromLabel = fromQ;
				routeToLabel = toQ;

				// Build a street-name timeline from OSRM's turn-by-turn steps, so the
				// 3D view can show "what street am I on" as distance progresses.
				routeStreetSegments = [];
				const allSteps = (data.routes[0].legs || []).flatMap(leg => leg.steps || []);
				let cursorKm = 0;
				allSteps.forEach(step => {
					const lenKm = (step.distance || 0)/1000;
					routeStreetSegments.push({
						name: step.name && step.name.trim() ? step.name.trim() : 'Unnamed road',
						fromKm: cursorKm,
						toKm: cursorKm + lenKm
					});
					cursorKm += lenKm;
				});

				// Detect the region up front from the route's location alone (no
				// elevation yet) and apply it BEFORE the ribbon builds, so the very
				// first scenery pass already uses region densities/palette. Refined
				// once the real elevation profile lands (see below).
				region = detectRegion(coords, null);
				if(apply3DRegion) apply3DRegion(region);

				if(build3DRoute) build3DRoute(coords);

				// Non-blocking: nearby POIs are a nice-to-have on top of an already
				// working route, so a slow or rate-limited Overpass request just
				// leaves the ride without POIs rather than delaying "route ready".
				routePOIs = [];
				if(place3DPOIs) place3DPOIs([]);
				fetchRoutePOIs(coords).then(pois => {
					routePOIs = pois;
					if(place3DPOIs) place3DPOIs(pois);
					logEvent('route', `found ${pois.length} nearby place${pois.length === 1 ? '' : 's'} from OpenStreetMap`);
				}).catch(err => {
					console.error('Could not fetch nearby places:', err);
				});

				// Same non-blocking treatment for elevation -- the resistance suggestion
				// is a nice-to-have, not something "route ready" should wait on.
				routeElevationKm = [];
				routeElevationM = [];
				if(els.resistanceSuggestLabel) els.resistanceSuggestLabel.classList.remove('show');
				fetchRouteElevation().then(profile => {
					if(!profile) return;
					routeElevationKm = profile.km;
					routeElevationM = profile.elevM;
					if(!routeActive) return;

					// Re-detect with the real elevation signal (corroborates/overrides
					// the bbox guess), then rebuild the ribbon so it lifts from flat
					// into true 3D relief -- build3DRoute reads the elevation globals we
					// just populated. POIs are re-placed onto the new elevated path.
					region = detectRegion(routeCoords, profile);
					if(apply3DRegion) apply3DRegion(region);
					if(build3DRoute) build3DRoute(routeCoords);
					if(place3DPOIs) place3DPOIs(routePOIs);
					// The rebuild recreates the flat ground strip visible again -- re-apply
					// any already-loaded terrain so it hides it and rebuilds against the
					// now-correct elevation baseline.
					if(apply3DTerrain && routeTerrain) apply3DTerrain(routeTerrain);

					updateRouteProgress(Math.min(distanceKm, routeTotalKm));
				}).catch(err => {
					console.error('Could not fetch elevation:', err);
				});

				// Real surrounding terrain (DEM corridor) -- heaviest fetch, fully
				// non-blocking. The ride is already flat-then-elevated by the time this
				// lands; applying it swaps the flat ground for actual mountainsides.
				routeTerrain = null;
				fetchRouteTerrain().then(terrain => {
					if(!routeActive || !terrain) return;
					routeTerrain = terrain;
					if(apply3DTerrain) apply3DTerrain(terrain);
					logEvent('route', `built surrounding terrain (${terrain.stations}×${terrain.cols} DEM samples)`);
				}).catch(err => {
					console.error('Could not fetch terrain:', err);
				});

				if(routeLayer) map.removeLayer(routeLayer);
				routeLayer = L.polyline(coords.map(c => [c.lat, c.lng]), {color: '#4dc8ff', weight: 4}).addTo(map);
				map.fitBounds(routeLayer.getBounds(), {padding: [24, 24]});

				if(riderMarker) map.removeLayer(riderMarker);
				riderMarker = L.circleMarker([coords[0].lat, coords[0].lng], {
					radius: 8, color: '#f4c430', weight: 2, fillColor: '#f4c430', fillOpacity: 1
				}).addTo(map);

				initMiniMap();
				if(miniRouteLayer) miniMap.removeLayer(miniRouteLayer);
				miniRouteLayer = L.polyline(coords.map(c => [c.lat, c.lng]), {color: '#4dc8ff', weight: 3}).addTo(miniMap);
				miniMap.fitBounds(miniRouteLayer.getBounds(), {padding: [4, 4]});
				if(miniRiderMarker) miniMap.removeLayer(miniRiderMarker);
				miniRiderMarker = L.circleMarker([coords[0].lat, coords[0].lng], {
					radius: 5, color: '#f4c430', weight: 1.5, fillColor: '#f4c430', fillOpacity: 1
				}).addTo(miniMap);
				if(els.miniMapWrap) els.miniMapWrap.classList.add('show');
				setTimeout(() => { if(miniMap) miniMap.invalidateSize(); }, 50);

				// Show the ride-view progress overlay right away at 0%, so it's visible
				// as soon as a route is chosen (before the ride even starts).
				if(els.rideProgressLabel) {
					els.rideProgressLabel.textContent = `0.00 / ${routeTotalKm.toFixed(1)} km · 0%`;
					els.rideProgressLabel.classList.add('show');
				}

				els.routeStatus.textContent = `Route ready — ${routeTotalKm.toFixed(1)} km. Start your ride to begin travelling it.`;
			} catch(err) {
				console.error(err);
				routeActive = false;
				routeStreetSegments = [];
				routePOIs = [];
				routeElevationKm = [];
				routeElevationM = [];
				region = null;
				routeTerrain = null;
				if(els.streetNameLabel) els.streetNameLabel.classList.remove('show');
				if(els.resistanceSuggestLabel) els.resistanceSuggestLabel.classList.remove('show');
				if(els.miniMapWrap) els.miniMapWrap.classList.remove('show');
				if(els.rideProgressLabel) els.rideProgressLabel.classList.remove('show');
				if(clear3DRoute) clear3DRoute();
				if(apply3DRegion) apply3DRegion(null); // restore generic palette/scenery, hide mountains
				if(apply3DTerrain) apply3DTerrain(null); // remove any surrounding terrain
				els.routeStatus.textContent = 'Could not build route: ' + err.message;
			} finally {
				els.findRouteBtn.disabled = false;
			}
		}

		function getStreetNameAtKm(km) {
			if(routeStreetSegments.length === 0) return null;
			const seg = routeStreetSegments.find(s => km >= s.fromKm && km < s.toKm);
			return seg ? seg.name : routeStreetSegments[routeStreetSegments.length - 1].name;
		}

		function latLngAtKm(km) {
			const clamped = Math.max(0, Math.min(km, routeTotalKm));
			let i = 0;
			while(i < routeCumDist.length - 1 && routeCumDist[i + 1] < clamped) i++;
			const segStart = routeCumDist[i];
			const segEnd = routeCumDist[i + 1] !== undefined ? routeCumDist[i + 1] : segStart;
			const segLen = segEnd - segStart;
			const t = segLen > 0 ? (clamped - segStart)/segLen : 0;
			const a = routeCoords[i];
			const b = routeCoords[i + 1] || a;
			return {lat: a.lat + (b.lat - a.lat)*t, lng: a.lng + (b.lng - a.lng)*t};
		}

		function bearingDeg(a, b) {
			const lat1 = a.lat*Math.PI/180, lat2 = b.lat*Math.PI/180;
			const dLng = (b.lng - a.lng)*Math.PI/180;
			const y = Math.sin(dLng)*Math.cos(lat2);
			const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
			return (Math.atan2(y, x)*180/Math.PI + 360)%360;
		}

		let lastMiniMapBearing = 0;

		// Average gradient of whichever elevation sample segment covers `km` --
		// samples are ~150m apart (see sampleRouteByDistance), so this is a "grade
		// over the next stretch" figure, not a jittery point-to-point one.
		function gradePercentAtKm(km) {
			if(routeElevationKm.length < 2) return null;
			let i = 0;
			while(i < routeElevationKm.length - 2 && routeElevationKm[i + 1] < km) i++;
			const kmA = routeElevationKm[i], kmB = routeElevationKm[i + 1];
			const distM = (kmB - kmA)*1000;
			if(distM <= 0) return 0;
			return ((routeElevationM[i + 1] - routeElevationM[i])/distM)*100;
		}

		// A simple, common cycling-gradient bucketing -- flat/downhill needs the
		// least resistance, double-digit climbs need the most. Tune freely; this is
		// a starting suggestion, not a physics model of any particular trainer.
		function suggestResistance(gradePercent) {
			if(gradePercent < 0) return 1;
			if(gradePercent < 2) return 2;
			if(gradePercent < 4) return 3;
			if(gradePercent < 6) return 4;
			if(gradePercent < 8) return 5;
			if(gradePercent < 10) return 6;
			return 7;
		}

		function updateRouteProgress(coveredKm) {
			if(!routeActive || routeCoords.length === 0) return;
			const clamped = Math.min(coveredKm, routeTotalKm);
			const {lat, lng} = latLngAtKm(clamped);

			if(riderMarker) riderMarker.setLatLng([lat, lng]);
			if(followRider && map) map.panTo([lat, lng], {animate: true});

			if(miniRiderMarker) miniRiderMarker.setLatLng([lat, lng]);
			if(miniMap) {
				miniMap.setView([lat, lng], 16, {animate: false});

				// Track-up minimap: rotate the map layer so the direction of travel
				// always points from the bottom of the minimap to the top, instead of
				// a fixed north-up view where the road's on-screen angle turns as the
				// real-world heading changes. #miniMap is oversized and centered inside
				// its cropped wrapper (see its inline style) so rotated corners never
				// show blank tiles.
				const lookahead = latLngAtKm(clamped + 0.02);
				if(lookahead.lat !== lat || lookahead.lng !== lng) {
					lastMiniMapBearing = bearingDeg({lat, lng}, lookahead);
				}
				miniMap.getContainer().style.transform = `rotate(${-lastMiniMapBearing}deg)`;
			}

			if(els.streetNameLabel){
				const name = getStreetNameAtKm(clamped);
				if(name){
					els.streetNameLabel.textContent = name;
					els.streetNameLabel.classList.add('show');
				}
			}

			if(els.resistanceSuggestLabel){
				const grade = gradePercentAtKm(clamped);
				if(grade != null){
					const level = suggestResistance(grade);
					const sign = grade > 0.05 ? '+' : '';
					els.resistanceSuggestLabel.textContent = `Resistance ${level} · ${sign}${grade.toFixed(1)}%`;
					els.resistanceSuggestLabel.classList.add('show');
				} else {
					els.resistanceSuggestLabel.classList.remove('show');
				}
			}

			const pct = routeTotalKm > 0 ? Math.min(100, (clamped/routeTotalKm)*100) : 0;
			els.routeStatus.textContent = clamped >= routeTotalKm
				? `Route complete — ${routeTotalKm.toFixed(1)} km! 🏁`
				: `${clamped.toFixed(2)} / ${routeTotalKm.toFixed(1)} km · ${pct.toFixed(0)}%`;

			// Mirror the same progress into the ride-view overlay so you can see how far
			// along the route you are without scrolling down to the Route section.
			if(els.rideProgressLabel) {
				els.rideProgressLabel.textContent = clamped >= routeTotalKm
					? `${routeTotalKm.toFixed(1)} km · 100% 🏁`
					: `${clamped.toFixed(2)} / ${routeTotalKm.toFixed(1)} km · ${pct.toFixed(0)}%`;
				els.rideProgressLabel.classList.add('show');
			}
		}

		els.findRouteBtn.addEventListener('click', findRoute);
		els.followToggle.addEventListener('change', () => {
			followRider = els.followToggle.checked;
		});
