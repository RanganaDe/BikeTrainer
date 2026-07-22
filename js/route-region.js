		// ---------- geographic region detection & biome profiles ----------
		// Pure, dependency-free. Loaded before route.js so findRoute() can call
		// detectRegion(), and before ride3d.js so init3D() can default to the
		// generic profile. Shares the single global scope (no modules/bundler).
		//
		// A "region profile" bundles everything the 3D view needs to make one
		// place feel different from another: how much to exaggerate the real
		// elevation, the biome colour palette (grass/rock/foliage), roadside
		// scenery mix, and whether to raise distant mountains on the horizon.
		// ride3d.js reads these; it never mutates the profile objects.

		// Country bounding boxes from the feature spec. Primary region vote.
		const REGION_BBOX = {
			switzerland: {south: 45.8, north: 47.8, west: 5.9,  east: 10.5},
			netherlands: {south: 50.7, north: 53.6, west: 3.4,  east: 7.2},
		};

		const REGION_PROFILES = {
			// The generic profile reproduces the current look exactly, so any route
			// whose region is unknown (or whose elevation contradicts its bbox)
			// renders just as it did before this feature existed -- no regression.
			generic: {
				name: 'generic', label: 'Countryside', elevationScale: 1.0, mountains: false,
				palette: {
					grass: 0x9fb89a, rock: 0x82888f,
					leaves: [0x27632f, 0x32783b, 0x225429, 0x418c4c],
				},
				// forestBias/openFieldBias push a roadside slot toward trees or open
				// field; windmillChance/rockBias sprinkle those into the non-forest
				// mix. All zero here == today's untouched behaviour.
				scenery: {treeCountMin: 1, treeCountSpan: 3, forestBias: 0, openFieldBias: 0, windmillChance: 0, rockBias: 0},
			},
			switzerland: {
				name: 'switzerland', label: 'Swiss Alps', elevationScale: 1.35, mountains: true,
				palette: {
					grass: 0x86a67e, rock: 0x9aa0a8,
					leaves: [0x1f4d28, 0x24592c, 0x1a4423, 0x2d6636], // dark alpine conifers
				},
				scenery: {treeCountMin: 2, treeCountSpan: 4, forestBias: 0.35, openFieldBias: 0, windmillChance: 0, rockBias: 0.4},
			},
			netherlands: {
				name: 'netherlands', label: 'Dutch Polders', elevationScale: 1.0, mountains: false,
				palette: {
					grass: 0xa8c49a, rock: 0x82888f,
					leaves: [0x3a7a3f, 0x458c4a, 0x336b38, 0x4f9c54], // lighter lowland deciduous
				},
				scenery: {treeCountMin: 1, treeCountSpan: 1, forestBias: 0, openFieldBias: 0.45, windmillChance: 0.22, rockBias: 0},
			},
		};

		// Bbox is the primary vote; the real fetched elevation profile (when
		// available) corroborates it and overrides the extremes -- a flat valley
		// route inside the Swiss box shouldn't sprout fake peaks, and genuinely
		// mountainous relief anywhere reads as alpine even outside the box.
		function detectRegion(coords, elevProfile) {
			if(!coords || !coords.length) return REGION_PROFILES.generic;

			let sumLat = 0, sumLng = 0;
			for(const c of coords) { sumLat += c.lat; sumLng += c.lng; }
			const lat = sumLat/coords.length, lng = sumLng/coords.length;

			const inBox = b => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
			let name = inBox(REGION_BBOX.switzerland) ? 'switzerland'
				: inBox(REGION_BBOX.netherlands) ? 'netherlands'
				: 'generic';

			// Elevation signal: total relief across the route, and how low it sits.
			let range = null, mean = null;
			if(elevProfile && elevProfile.elevM && elevProfile.elevM.length) {
				const es = elevProfile.elevM.filter(v => typeof v === 'number');
				if(es.length) {
					const mn = Math.min(...es), mx = Math.max(...es);
					range = mx - mn;
					mean = es.reduce((a, b) => a + b, 0)/es.length;
				}
			}

			if(range != null) {
				if(name === 'switzerland' && range < 120) name = 'generic';   // flat valley -> don't force mountains
				else if(name === 'netherlands' && range > 200) name = 'generic'; // unexpectedly hilly -> not polder
				else if(name === 'generic') {
					if(range > 350) name = 'switzerland';                        // big relief anywhere -> alpine
					else if(range < 25 && mean != null && mean < 40) name = 'netherlands'; // dead flat & near sea level -> polder
				}
			}

			return REGION_PROFILES[name] || REGION_PROFILES.generic;
		}
