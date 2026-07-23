		// ---------- data-driven environment profiles ----------
		// Pure, dependency-free. Loaded before route.js so findRoute() can call
		// detectRegion(), and before ride3d.js so init3D() can default to the
		// generic profile. Shares the single global scope (no modules/bundler).
		//
		// A "region profile" bundles everything the 3D view needs to make one
		// place feel different from another: how much to exaggerate the real
		// elevation, the biome colour palette (grass/rock/foliage), roadside
		// scenery mix, and whether to raise distant mountains on the horizon.
		// ride3d.js reads these (region.elevationScale/mountains/palette/scenery);
		// it never mutates the returned object.
		//
		// Rather than a hardcoded country list, detectRegion() BUILDS a profile for
		// ANY route on Earth from three measurable signals, each optional:
		//   1. latitude          -> climate band (palette + baseline scenery density)
		//   2. elevation relief  -> elevationScale + distant mountains
		//   3. OSM landcover      -> scenery mix (forest vs open field, arid override)
		// With none supplied it degrades to a neutral temperate look, so a route with
		// no data still renders sanely -- and a temperate route with flat terrain and
		// no landcover reproduces the old 'generic' look exactly (no regression).

		// Climate palettes keyed by absolute latitude band. `temperate` is byte-for-byte
		// the old generic palette, so mid-latitude routes look identical to before.
		const CLIMATE_BANDS = {
			tropical: {
				name: 'tropical', label: 'Tropics',
				palette: { grass: 0x6fae5f, rock: 0x8a7f72, leaves: [0x1f7a35, 0x2b9245, 0x176b2c, 0x35a353] },
				scenery: { treeCountMin: 2, treeCountSpan: 4, forestBias: 0.4, openFieldBias: 0, windmillChance: 0, rockBias: 0 },
			},
			subtropical: {
				name: 'subtropical', label: 'Subtropics',
				palette: { grass: 0x9bb56a, rock: 0x8f8778, leaves: [0x3d7a34, 0x4e8f3d, 0x336b2e, 0x5aa049] },
				scenery: { treeCountMin: 1, treeCountSpan: 3, forestBias: 0.2, openFieldBias: 0.1, windmillChance: 0, rockBias: 0.05 },
			},
			temperate: {
				name: 'temperate', label: 'Countryside',
				palette: { grass: 0x9fb89a, rock: 0x82888f, leaves: [0x27632f, 0x32783b, 0x225429, 0x418c4c] },
				scenery: { treeCountMin: 1, treeCountSpan: 3, forestBias: 0, openFieldBias: 0, windmillChance: 0, rockBias: 0 },
			},
			boreal: {
				name: 'boreal', label: 'Northern Forest',
				palette: { grass: 0x7e9b78, rock: 0x8b929a, leaves: [0x1c3f24, 0x24512c, 0x18381f, 0x2b5c33] }, // dark conifers
				scenery: { treeCountMin: 2, treeCountSpan: 3, forestBias: 0.45, openFieldBias: 0, windmillChance: 0, rockBias: 0.15 },
			},
			polar: {
				name: 'polar', label: 'Highlands',
				palette: { grass: 0x8a9184, rock: 0x9aa0a8, leaves: [0x33502f, 0x3d5c37, 0x2b4629, 0x466b3f] },
				scenery: { treeCountMin: 0, treeCountSpan: 2, forestBias: 0, openFieldBias: 0.3, windmillChance: 0, rockBias: 0.4 },
			},
		};

		// Dry-country override, applied when OSM landcover says the corridor is mostly
		// desert/sand/scrub -- deserts sit at latitudes that would otherwise read as
		// tropical/subtropical, so only the landcover signal can catch them.
		const ARID_PALETTE = { grass: 0xc2b280, rock: 0xb08d57, leaves: [0x6b7a3a, 0x7d8a44, 0x5c6b33, 0x8a9450] };

		// The generic profile is still exported: ride3d.js uses it as its pre-route
		// default (init3D reads REGION_PROFILES.generic), and detectRegion falls back
		// to it when there are no coords to reason about. It equals the temperate band.
		const REGION_PROFILES = {
			generic: {
				name: 'generic', label: 'Countryside', elevationScale: 1.0, mountains: false,
				palette: { grass: 0x9fb89a, rock: 0x82888f, leaves: [0x27632f, 0x32783b, 0x225429, 0x418c4c] },
				scenery: { treeCountMin: 1, treeCountSpan: 3, forestBias: 0, openFieldBias: 0, windmillChance: 0, rockBias: 0 },
			},
		};

		function clamp01(v) { return Math.max(0, Math.min(1, v)); }

		function climateBandFor(lat) {
			const a = Math.abs(lat);
			if(a < 23.5) return CLIMATE_BANDS.tropical;
			if(a < 35)   return CLIMATE_BANDS.subtropical;
			if(a < 55)   return CLIMATE_BANDS.temperate;
			if(a < 66.5) return CLIMATE_BANDS.boreal;
			return CLIMATE_BANDS.polar;
		}

		// Elevation relief -> exaggeration + distant mountains. Deliberately kept as
		// conservative as the original country-based code: it exaggerated (and raised
		// mountains) ONLY for genuinely alpine relief (>350m), leaving everything else
		// at true 1:1 scale. Moderate hills therefore render exactly as before -- no
		// extra exaggeration, no mountains -- which matters because exaggerated relief
		// is what surfaces the hairpin "camera under terrain / green screen" fold bug
		// (see memory: terrain-green-overlay-bug). Real DEM at scale 1.0 is still
		// visibly hilly; we just don't amplify it.
		function elevationShape(elevProfile) {
			let range = null, mean = null;
			if(elevProfile && elevProfile.elevM && elevProfile.elevM.length) {
				const es = elevProfile.elevM.filter(v => typeof v === 'number' && isFinite(v));
				if(es.length) {
					range = Math.max(...es) - Math.min(...es);
					mean = es.reduce((a, b) => a + b, 0)/es.length;
				}
			}
			let elevationScale = 1.0, mountains = false;
			if(range != null) {
				if(range > 700)      { elevationScale = 1.35; mountains = true; }
				else if(range > 350) { elevationScale = 1.2;  mountains = true; }
				// <=350m relief: true 1:1, no mountains -- identical to the old generic.
			}
			return { elevationScale, mountains, range, mean };
		}

		// coords:      route polyline [{lat,lng}] -- only the centroid latitude is used.
		// elevProfile: {elevM:[...]} once fetched (null on the first, pre-elevation call).
		// landcover:   optional {forest, farmland, arid, water} OSM element counts; when
		//              present, refines the scenery mix and can trigger the arid palette.
		function detectRegion(coords, elevProfile, landcover) {
			if(!coords || !coords.length) return REGION_PROFILES.generic;

			let sumLat = 0;
			for(const c of coords) sumLat += c.lat;
			const lat = sumLat/coords.length;

			const band = climateBandFor(lat);
			const elev = elevationShape(elevProfile);

			// Start from the climate band's palette + scenery, cloned so the shared
			// base objects are never mutated by the refinements below.
			const palette = {
				grass: band.palette.grass,
				rock: band.palette.rock,
				leaves: band.palette.leaves.slice(),
			};
			const scenery = Object.assign({}, band.scenery);
			let name = band.name, label = band.label;

			// High, sustained elevation reads as bare alpine rock regardless of latitude.
			if(elev.mountains && elev.mean != null && elev.mean > 1400) {
				palette.rock = 0x9aa0a8;
				scenery.rockBias = Math.max(scenery.rockBias, 0.4);
				label = band.label + ' · Alpine';
			}

			// OSM landcover refinement (best-effort): shift the roadside mix toward what
			// actually surrounds the road, and override to a dry palette where the
			// corridor is mostly desert/scrub. Missing/empty landcover leaves the
			// climate defaults untouched.
			if(landcover) {
				const forest = landcover.forest || 0, farmland = landcover.farmland || 0, arid = landcover.arid || 0;
				const total = forest + farmland + arid;
				if(total > 0) {
					const forestR = forest/total, farmR = farmland/total, aridR = arid/total;

					scenery.forestBias = clamp01(Math.max(scenery.forestBias, forestR*0.9));
					if(forestR > 0.4) { scenery.treeCountMin += 1; scenery.treeCountSpan += 1; }

					scenery.openFieldBias = clamp01(Math.max(scenery.openFieldBias, farmR*0.7));
					// Windmills only where it's genuinely flat farmland -- a data-driven
					// echo of the old Dutch-polder look, no longer tied to a country box.
					if(farmR > 0.5 && !elev.mountains) scenery.windmillChance = Math.min(0.15, farmR*0.2);

					if(aridR > 0.35) {
						palette.grass = ARID_PALETTE.grass;
						palette.rock = ARID_PALETTE.rock;
						palette.leaves = ARID_PALETTE.leaves.slice();
						scenery.rockBias = Math.max(scenery.rockBias, 0.5);
						scenery.treeCountMin = 0;
						scenery.forestBias = Math.min(scenery.forestBias, 0.1);
						name = 'arid'; label = 'Arid';
					}
				}
			}

			return { name, label, elevationScale: elev.elevationScale, mountains: elev.mountains, palette, scenery };
		}