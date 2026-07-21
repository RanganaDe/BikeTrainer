		// ---------- route / virtual ride map ----------
		let map = null, routeLayer = null, riderMarker = null;
		let routeCoords = [];   // [{lat, lng}, ...] along the route
		let routeCumDist = [];  // cumulative km at each coordinate
		let routeTotalKm = 0;
		let routeActive = false;
		let followRider = true;
		let routeFromLabel = '', routeToLabel = '';
		let routeStreetSegments = []; // [{name, fromKm, toKm}, ...] built from OSRM's turn-by-turn steps

		// Bridged into by init3D() once it runs, so findRoute() (defined here, outside
		// the 3D closure) can hand real route coordinates to the 3D scene.
		let build3DRoute = null;
		let clear3DRoute = null;

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
				if(!res.ok) throw new Error('Routing request failed');
				const data = await res.json();
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

				if(build3DRoute) build3DRoute(coords);

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

				els.routeStatus.textContent = `Route ready — ${routeTotalKm.toFixed(1)} km. Start your ride to begin travelling it.`;
			} catch(err) {
				console.error(err);
				routeActive = false;
				routeStreetSegments = [];
				if(els.streetNameLabel) els.streetNameLabel.classList.remove('show');
				if(els.miniMapWrap) els.miniMapWrap.classList.remove('show');
				if(clear3DRoute) clear3DRoute();
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

		function updateRouteProgress(coveredKm) {
			if(!routeActive || routeCoords.length === 0) return;
			const clamped = Math.min(coveredKm, routeTotalKm);
			let i = 0;
			while(i < routeCumDist.length - 1 && routeCumDist[i + 1] < clamped) i++;
			const segStart = routeCumDist[i];
			const segEnd = routeCumDist[i + 1] !== undefined ? routeCumDist[i + 1] : segStart;
			const segLen = segEnd - segStart;
			const t = segLen > 0 ? (clamped - segStart)/segLen : 0;
			const a = routeCoords[i];
			const b = routeCoords[i + 1] || a;
			const lat = a.lat + (b.lat - a.lat)*t;
			const lng = a.lng + (b.lng - a.lng)*t;

			if(riderMarker) riderMarker.setLatLng([lat, lng]);
			if(followRider && map) map.panTo([lat, lng], {animate: true});

			if(miniRiderMarker) miniRiderMarker.setLatLng([lat, lng]);
			if(miniMap) miniMap.setView([lat, lng], 16, {animate: false});

			if(els.streetNameLabel){
				const name = getStreetNameAtKm(clamped);
				if(name){
					els.streetNameLabel.textContent = name;
					els.streetNameLabel.classList.add('show');
				}
			}

			const pct = routeTotalKm > 0 ? Math.min(100, (clamped/routeTotalKm)*100) : 0;
			els.routeStatus.textContent = clamped >= routeTotalKm
				? `Route complete — ${routeTotalKm.toFixed(1)} km! 🏁`
				: `${clamped.toFixed(2)} / ${routeTotalKm.toFixed(1)} km · ${pct.toFixed(0)}%`;
		}

		els.findRouteBtn.addEventListener('click', findRoute);
		els.followToggle.addEventListener('change', () => {
			followRider = els.followToggle.checked;
		});
