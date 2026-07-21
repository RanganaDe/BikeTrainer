		// ---------- 3D ride view ----------
		// High-performance procedural bike-view simulation with localized, recycled segments
		const VISUAL_SCALE = 0.75; // Tuned for rapid roadside object feedback
		let ride3dBobPhase = 0;
		let currentWorldProgress = 0; // Tracks overall world position for structural features

		function init3D() {
			if(!window.THREE || !els.ride3dCanvas) return;
			const container = els.ride3dCanvas;
			const width = container.clientWidth || 300;
			const height = container.clientHeight || 260;

			const scene = new THREE.Scene();

			// Gradient sky (drawn to a small canvas, not a flat color) -- pale near
			// the horizon, deeper overhead. Kept redrawable so time-of-day lighting
			// can shift its colors live rather than baking them in once.
			const skyCanvas = document.createElement('canvas');
			skyCanvas.width = 2; skyCanvas.height = 256;
			const skyCtx = skyCanvas.getContext('2d');
			const skyTexture = new THREE.CanvasTexture(skyCanvas);

			function paintSky(topColor, midColor, horizonColor){
				const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
				grad.addColorStop(0, topColor);
				grad.addColorStop(0.55, midColor);
				grad.addColorStop(1, horizonColor);
				skyCtx.fillStyle = grad;
				skyCtx.fillRect(0, 0, 2, 256);
				skyTexture.needsUpdate = true;
			}
			paintSky('#4f8fd6', '#a9d4ec', '#dcedf5');
			scene.background = skyTexture;

			// Small procedural textures (drawn at runtime, no image files needed) so
			// the ground/road read as textured surfaces instead of flat color fills.
			function makeCanvasTexture(size, drawFn, repeatX, repeatY){
				const c = document.createElement('canvas');
				c.width = size; c.height = size;
				drawFn(c.getContext('2d'), size);
				const tex = new THREE.CanvasTexture(c);
				tex.wrapS = THREE.RepeatWrapping;
				tex.wrapT = THREE.RepeatWrapping;
				tex.repeat.set(repeatX, repeatY);
				return tex;
			}

			const grassTexture = makeCanvasTexture(128, (ctx, s) => {
				ctx.fillStyle = '#4f7f49';
				ctx.fillRect(0, 0, s, s);
				for(let i = 0; i < 900; i++){
					const x = Math.random()*s, y = Math.random()*s;
					const shade = Math.random() < 0.5 ? 'rgba(30,55,26,0.25)' : 'rgba(140,190,120,0.18)';
					ctx.fillStyle = shade;
					ctx.fillRect(x, y, 1.6, 1.6);
				}
			}, 90, 90);

			const asphaltTexture = makeCanvasTexture(128, (ctx, s) => {
				ctx.fillStyle = '#303338';
				ctx.fillRect(0, 0, s, s);
				for(let i = 0; i < 700; i++){
					const x = Math.random()*s, y = Math.random()*s;
					const v = Math.random();
					ctx.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.06)';
					ctx.fillRect(x, y, 1.2, 1.2);
				}
			}, 1, 4);

			const gravelTexture = makeCanvasTexture(128, (ctx, s) => {
				ctx.fillStyle = '#4d5157';
				ctx.fillRect(0, 0, s, s);
				for(let i = 0; i < 500; i++){
					const x = Math.random()*s, y = Math.random()*s;
					ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.10)';
					ctx.fillRect(x, y, 1.4, 1.4);
				}
			}, 1, 4);

			// Route-ribbon geometry encodes tiling directly in its UVs (real metres per
			// repeat), so these clones must NOT also carry a baked-in repeat factor --
			// that would double up and make the texture tile far too densely.
			const asphaltTextureRibbon = asphaltTexture.clone();
			asphaltTextureRibbon.repeat.set(1, 1);
			const gravelTextureRibbon = gravelTexture.clone();
			gravelTextureRibbon.repeat.set(1, 1);

			// Dynamic exponential fog factor matching performance guidelines
			const baseFogNear = 35;
			const baseFogFar = 160;
			const currentFog = new THREE.Fog(0xdcedf5, baseFogNear, baseFogFar);
			scene.fog = currentFog;

			// Camera field of view matches natural biological wide angle adaptation at high velocity
			const BASE_FOV = 62;
			const camera = new THREE.PerspectiveCamera(BASE_FOV, width/height, 0.2, 600);

			// Camera base configuration lower to ground surface level for high velocity feeling
			const BASE_CAM_Y = 1.35;
			camera.position.set(0, BASE_CAM_Y, 8);

			const renderer = new THREE.WebGLRenderer({
				antialias: true,
				powerPreference: "high-performance"
			});
			renderer.setSize(width, height);
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			container.innerHTML = '';
			container.appendChild(renderer.domElement);

			// Well balanced illumination modeling out outdoor directional daylight shading.
			// Kept as named references (not inline scene.add(...)) so time-of-day can
			// retune their color/intensity/position live.
			const hemiLight = new THREE.HemisphereLight(0xffffff, 0x4d6e43, 0.95);
			scene.add(hemiLight);
			const sun = new THREE.DirectionalLight(0xffffff, 1.15);
			sun.position.set(40, 75, -20);
			scene.add(sun);


			// Procedural color sets for natural biome variety -- StandardMaterial (PBR-ish)
			// gives noticeably nicer light falloff than the flat Lambert shading used before,
			// and the ground/road now carry real (if simple, canvas-drawn) surface texture
			// instead of a single flat fill.
			const groundMat = new THREE.MeshStandardMaterial({color: 0x9fb89a, map: grassTexture, roughness: 0.95, metalness: 0});
			const roadMat = new THREE.MeshStandardMaterial({color: 0xb8b8bc, map: asphaltTexture, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide});
			const shoulderMat = new THREE.MeshStandardMaterial({color: 0xb0b0b4, map: gravelTexture, roughness: 0.9, metalness: 0, side: THREE.DoubleSide});
			const edgeLineMat = new THREE.MeshBasicMaterial({color: 0xffffff});
			const stripeMat = new THREE.MeshBasicMaterial({color: 0xe6e6df});
			const rockMat = new THREE.MeshStandardMaterial({color: 0x82888f, roughness: 0.75});
			const fenceMat = new THREE.MeshStandardMaterial({color: 0x8c6d53, roughness: 0.85});
			const bushMat = new THREE.MeshStandardMaterial({color: 0x3a7843, roughness: 0.9});
			const trunkMat = new THREE.MeshStandardMaterial({color: 0x543c29, roughness: 0.9});

			const leafColors = [0x27632f, 0x32783b, 0x225429, 0x418c4c];
			const leavesMaterials = leafColors.map(c => new THREE.MeshStandardMaterial({color: c, roughness: 0.85}));

			// Environment boundaries and layout structure
			const SEG_LEN = 16;
			const SEG_COUNT = 15; // Increased depth distribution pattern
			const ROAD_WIDTH = 5.5;
			const SHOULDER_WIDTH = 1.2;
			const TOTAL_SURFACE_WIDTH = ROAD_WIDTH + (SHOULDER_WIDTH*2);
			const totalLen = SEG_LEN*SEG_COUNT;

			// Distant lake for a bit of far-off atmosphere
			const distantLake = new THREE.Mesh(
				new THREE.PlaneGeometry(160, 70),
				new THREE.MeshPhongMaterial({color: 0x3f7fae, shininess: 90, transparent: true, opacity: 0.8, fog: false})
			);
			distantLake.rotation.x = -Math.PI/2;
			distantLake.position.set(-115, -4.8, -135);
			scene.add(distantLake);

			// Base ground tracking mesh
			const baseGround = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat);
			baseGround.rotation.x = -Math.PI/2;
			baseGround.position.y = -0.15;
			scene.add(baseGround);

			// Recycled shared base meshes across segments to keep performance near 60 FPS
			const treeTrunkGeom = new THREE.CylinderGeometry(0.09, 0.16, 1.6, 5);
			const treeLeavesGeom = new THREE.ConeGeometry(1.1, 2.8, 6);
			const rockGeom = new THREE.DodecahedronGeometry(0.6, 0);
			const bushGeom = new THREE.SphereGeometry(0.7, 5, 4);
			const fenceRailGeom = new THREE.BoxGeometry(0.06, 0.12, SEG_LEN);
			const fencePostGeom = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 4);

			const lampPoleGeom = new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6);
			const lampPoleMat = new THREE.MeshStandardMaterial({color: 0x3d3d3d, roughness: 0.6, metalness: 0.4});
			const lampHeadGeom = new THREE.SphereGeometry(0.22, 8, 6);
			const lampHeadMat = new THREE.MeshStandardMaterial({color: 0xfff2b0, emissive: 0xffcc66, emissiveIntensity: 0.05, roughness: 0.5});

			const signPostGeom = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5);
			const signPostMat = new THREE.MeshStandardMaterial({color: 0x8a8a8a, roughness: 0.6, metalness: 0.3});
			const signBoardGeom = new THREE.BoxGeometry(0.55, 0.55, 0.04);
			const signBoardMats = [
				new THREE.MeshStandardMaterial({color: 0xd83c3c, roughness: 0.5}),
				new THREE.MeshStandardMaterial({color: 0xf4c430, roughness: 0.5}),
				new THREE.MeshStandardMaterial({color: 0x2f7dd8, roughness: 0.5})
			];

			const waterGeom = new THREE.PlaneGeometry(3.2, SEG_LEN*0.85);
			const waterMat = new THREE.MeshPhongMaterial({color: 0x4a90c4, shininess: 70, transparent: true, opacity: 0.85});

			const sheepBodyGeom = new THREE.SphereGeometry(0.35, 8, 6);
			const sheepBodyMat = new THREE.MeshStandardMaterial({color: 0xf2f2ea, roughness: 0.95});
			const sheepHeadGeom = new THREE.SphereGeometry(0.16, 6, 5);
			const sheepHeadMat = new THREE.MeshStandardMaterial({color: 0x3a3a3a, roughness: 0.8});

			const houseBodyGeom = new THREE.BoxGeometry(2.4, 2.2, 2.6);
			const houseWallColors = [0xe8dcc0, 0xd8c8a8, 0xc9d8c0, 0xd6c4b8, 0xecebe0];
			const houseWallMats = houseWallColors.map(c => new THREE.MeshStandardMaterial({color: c, roughness: 0.85}));
			const houseRoofGeom = new THREE.ConeGeometry(2.1, 1.5, 4);
			const houseRoofMat = new THREE.MeshStandardMaterial({color: 0x7a3a30, roughness: 0.8});
			const houseDoorGeom = new THREE.BoxGeometry(0.7, 1.1, 0.06);
			const houseDoorMat = new THREE.MeshStandardMaterial({color: 0x4a3324, roughness: 0.7});
			const houseWindowGeom = new THREE.BoxGeometry(0.5, 0.5, 0.06);
			const houseWindowMat = new THREE.MeshStandardMaterial({color: 0xbfe0ea, roughness: 0.3, metalness: 0.2, emissive: 0x1a2a30, emissiveIntensity: 0.15});

			const segments = [];

			// Local procedural curve calculations to prevent matrix generation errors
          function getRoadLayout(worldZ) {
            // Curve/elevation disabled for now -- straight flat road while we
            // confirm the disappearing-road issue is unrelated to this.
            return {
              x: 0,
              y: 0
            };
          }
			// Populate localized tracking data structure array
			for(let i = 0; i < SEG_COUNT; i++) {
				const segmentGroup = new THREE.Group();

				// Structural Road Assembly
				const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, SEG_LEN), roadMat);
				road.rotation.x = -Math.PI/2;
				segmentGroup.add(road);

				// Shoulders Left/Right
				[-1, 1].forEach(side => {
					const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(SHOULDER_WIDTH, SEG_LEN), shoulderMat);
					shoulder.rotation.x = -Math.PI/2;
					shoulder.position.set(side*(ROAD_WIDTH/2 + SHOULDER_WIDTH/2), -0.002, 0);

					const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, SEG_LEN), edgeLineMat);
					line.rotation.x = -Math.PI/2;
					line.position.set(side*(ROAD_WIDTH/2), 0.002, 0);

					segmentGroup.add(shoulder, line);
				});

				// Continuous Center Dashes
				const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.16, SEG_LEN*0.4), stripeMat);
				stripe.rotation.x = -Math.PI/2;
				stripe.position.set(0, 0.005, 0);
				segmentGroup.add(stripe);

				// Scenery wrapper group container to handle instant isolated recycling calls
				const sceneryGroup = new THREE.Group();
				segmentGroup.add(sceneryGroup);

				const baseZ = -i*SEG_LEN;

				segmentGroup.position.z = baseZ;

				const layout = getRoadLayout(baseZ);
				segmentGroup.position.x = layout.x;
				segmentGroup.position.y = layout.y;

				scene.add(segmentGroup);

				const segData = {
					group: segmentGroup,
					scenery: sceneryGroup,
					initialZ: baseZ
				};

				populateScenery(segData.scenery, baseZ);
				segments.push(segData);
			}

			function populateScenery(group, worldZ) {
				// Clear out previous tracking instances
				while(group.children.length > 0) {
					group.remove(group.children[0]);
				}

				const seed = Math.abs(Math.sin(worldZ));
				const leftSideActive = (seed*10)%2 > 0.7;
				const rightSideActive = (seed*100)%2 > 0.7;

				[-1, 1].forEach(side => {
					const sideActive = side === -1 ? leftSideActive : rightSideActive;
					const sideSeed = side === -1 ? seed : (seed*5)%1;
					const lateralOffset = side*(TOTAL_SURFACE_WIDTH/2 + 1.2);

					if(sideActive) {
						// Forest Generation Logic
						const treeCount = 1 + Math.floor(sideSeed*3);
						for(let t = 0; t < treeCount; t++) {
							const tree = new THREE.Group();
							const trunk = new THREE.Mesh(treeTrunkGeom, trunkMat);
							trunk.position.y = 0.8;

							const matIndex = Math.floor(((sideSeed*10) + t)%leavesMaterials.length);
							const leaves = new THREE.Mesh(treeLeavesGeom, leavesMaterials[matIndex]);
							leaves.position.y = 2.4;

							tree.add(trunk, leaves);

							// Random variation variables
							const scaleY = 0.85 + (sideSeed*0.5);
							const scaleXZ = 0.8 + (((sideSeed*3) + t)%1)*0.4;
							tree.scale.set(scaleXZ, scaleY, scaleXZ);

							const localX = lateralOffset + (side*(t*2.2 + (sideSeed*1.5)));
							const localZ = -SEG_LEN/2 + (((sideSeed*7) + t)%1)*SEG_LEN;
							tree.position.set(localX, 0, localZ);
							group.add(tree);
						}
					} else {
						// Alternative element populating configuration (Rocks, Fences, Grass, Bushes, Lamp posts, Signs, Water, Sheep, Houses)
						const variantType = Math.floor(sideSeed*9);
						const localZPoint = -SEG_LEN/2 + (sideSeed*SEG_LEN);

						if(variantType === 0) { // Rock Group
							const rock = new THREE.Mesh(rockGeom, rockMat);
							rock.position.set(lateralOffset + (side*0.8), 0.2, localZPoint);
							rock.rotation.set(sideSeed, sideSeed*2, 0);
							rock.scale.set(0.7 + sideSeed, 0.7 + sideSeed, 0.7 + sideSeed);
							group.add(rock);
						} else if(variantType === 1) { // Dense Bush Structures
							const bush = new THREE.Mesh(bushGeom, bushMat);
							bush.position.set(lateralOffset + (side*0.5), 0.3, localZPoint);
							bush.scale.set(1.2 + sideSeed*0.6, 0.7 + sideSeed*0.5, 1 + sideSeed*0.5);
							group.add(bush);
						} else if(variantType === 2) { // Modular Fence Sections
							const fence = new THREE.Group();
							const post1 = new THREE.Mesh(fencePostGeom, fenceMat);
							post1.position.set(lateralOffset, 0.55, -SEG_LEN/2);
							const post2 = new THREE.Mesh(fencePostGeom, fenceMat);
							post2.position.set(lateralOffset, 0.55, SEG_LEN/2);

							const rail1 = new THREE.Mesh(fenceRailGeom, fenceMat);
							rail1.position.set(lateralOffset, 0.75, 0);
							const rail2 = new THREE.Mesh(fenceRailGeom, fenceMat);
							rail2.position.set(lateralOffset, 0.40, 0);

							fence.add(post1, post2, rail1, rail2);
							group.add(fence);
						} else if(variantType === 3) { // Lamp post
							const lamp = new THREE.Group();
							const pole = new THREE.Mesh(lampPoleGeom, lampPoleMat);
							pole.position.y = 1.6;
							const head = new THREE.Mesh(lampHeadGeom, lampHeadMat);
							head.position.y = 3.25;
							lamp.add(pole, head);
							lamp.position.set(lateralOffset + (side*0.3), 0, localZPoint);
							group.add(lamp);
						} else if(variantType === 4) { // Roadside sign
							const sign = new THREE.Group();
							const post = new THREE.Mesh(signPostGeom, signPostMat);
							post.position.y = 0.9;
							const boardMat = signBoardMats[Math.floor((sideSeed*3))%signBoardMats.length];
							const board = new THREE.Mesh(signBoardGeom, boardMat);
							board.position.y = 1.75;
							board.rotation.y = side > 0 ? 0.3 : -0.3;
							sign.add(post, board);
							sign.position.set(lateralOffset, 0, localZPoint);
							group.add(sign);
						} else if(variantType === 5) { // Small grass tuft cluster (cheap filler variety)
							const tuft = new THREE.Mesh(bushGeom, bushMat);
							tuft.position.set(lateralOffset + (side*1.4), 0.05, localZPoint);
							tuft.scale.set(0.35, 0.2, 0.35);
							group.add(tuft);
						} else if(variantType === 6) { // Pond / water patch, set back from the road
							const water = new THREE.Mesh(waterGeom, waterMat);
							water.rotation.x = -Math.PI/2;
							water.position.set(lateralOffset + side*2.6, 0.02, localZPoint);
							group.add(water);
						} else if(variantType === 7) { // Small house, set well back from the road
							const house = new THREE.Group();
							const wallMat = houseWallMats[Math.floor(sideSeed*10)%houseWallMats.length];
							const body = new THREE.Mesh(houseBodyGeom, wallMat);
							body.position.y = 1.1;
							const roof = new THREE.Mesh(houseRoofGeom, houseRoofMat);
							roof.position.y = 2.5;
							roof.rotation.y = Math.PI/4;
							const door = new THREE.Mesh(houseDoorGeom, houseDoorMat);
							door.position.set(0, 0.55, 1.21);
							const window1 = new THREE.Mesh(houseWindowGeom, houseWindowMat);
							window1.position.set(-0.75, 1.3, 1.21);
							const window2 = new THREE.Mesh(houseWindowGeom, houseWindowMat);
							window2.position.set(0.75, 1.3, 1.21);
							house.add(body, roof, door, window1, window2);
							house.rotation.y = side > 0 ? -0.2 : 0.2;
							house.position.set(lateralOffset + side*3.4, 0, localZPoint);
							group.add(house);
						} else { // Grazing sheep cluster, set back in the field
							const sheepCount = 2 + Math.floor(sideSeed*3);
							for(let s = 0; s < sheepCount; s++){
								const sheep = new THREE.Group();
								const body = new THREE.Mesh(sheepBodyGeom, sheepBodyMat);
								body.scale.set(1, 0.85, 1.3);
								const head = new THREE.Mesh(sheepHeadGeom, sheepHeadMat);
								head.position.set(0, 0.05, 0.42);
								sheep.add(body, head);
								sheep.position.set(
									lateralOffset + side*(1.8 + s*0.6),
									0.32,
									localZPoint + (s*0.55 - sheepCount*0.25)
								);
								group.add(sheep);
							}
						}
					}
				});
			}

			// ---------- Real route mode ----------
			// When a route has been fetched (the same OSRM coordinates used for the
			// 2D map), build an actual finite road matching its true shape, and drive
			// the camera along it using the same `distanceKm` that already moves the
			// 2D marker. This replaces the infinite procedural road while active.
			// Elevation isn't available from OSRM's route geometry, so the ribbon is
			// flat -- real curvature, no fake hills.
			let routeRibbonGroup = null;
			let routeCameraPath = null; // { points:[{x,z}], cumDist:[...], totalLen }

			function projectRouteToLocal(coords) {
				const refLat = coords[0].lat*Math.PI/180;
				const mPerLat = 110574;
				const mPerLng = 111320*Math.cos(refLat);
				return coords.map(c => ({
					x: (c.lng - coords[0].lng)*mPerLng,
					z: -(c.lat - coords[0].lat)*mPerLat
				}));
			}

			function downsampleForRibbon(points, maxPoints) {
				if(points.length <= maxPoints) return points.slice();
				const step = points.length/maxPoints;
				const out = [];
				for(let i = 0; i < maxPoints; i++) out.push(points[Math.floor(i*step)]);
				out.push(points[points.length - 1]);
				return out;
			}

			function perpAt(points, i) {
				let dx, dz;
				if(i === 0) { dx = points[1].x - points[0].x; dz = points[1].z - points[0].z; }
				else if(i === points.length - 1) { dx = points[i].x - points[i-1].x; dz = points[i].z - points[i-1].z; }
				else { dx = points[i+1].x - points[i-1].x; dz = points[i+1].z - points[i-1].z; }
				const len = Math.sqrt(dx*dx + dz*dz) || 1;
				return { x: -dz/len, z: dx/len };
			}

			function buildRibbonGeometry(points, width, cumDist, tileLength) {
				const positions = [];
				const uvs = [];
				const halfW = width/2;
				for(let i = 0; i < points.length; i++) {
					const p = points[i];
					const pr = perpAt(points, i);
					const v = (cumDist ? cumDist[i] : i)/(tileLength || 4);
					positions.push(p.x - pr.x*halfW, 0, p.z - pr.z*halfW);
					uvs.push(0, v);
					positions.push(p.x + pr.x*halfW, 0, p.z + pr.z*halfW);
					uvs.push(1, v);
				}
				const indices = [];
				for(let i = 0; i < points.length - 1; i++) {
					const a = i*2, b = i*2 + 1, c = (i+1)*2, d = (i+1)*2 + 1;
					indices.push(a, b, c,  b, d, c);
				}
				const geom = new THREE.BufferGeometry();
				geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
				geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
				geom.setIndex(indices);
				geom.computeVertexNormals();
				return geom;
			}

			function clearRouteRibbon() {
				if(routeRibbonGroup) { scene.remove(routeRibbonGroup); routeRibbonGroup = null; }
				routeCameraPath = null;
				segments.forEach(s => { s.group.visible = true; });
				rivalGroup.visible = true;
				rivalGroup.position.set(-LANE_OFFSET, 0, -70);
			}

			function buildRouteRibbon(coordsLatLng) {
				clearRouteRibbon();
				if(!coordsLatLng || coordsLatLng.length < 2) return;

				const projectedFull = projectRouteToLocal(coordsLatLng);
				const controlPoints = downsampleForRibbon(projectedFull, 220);

				// Connecting the raw control points with straight segments gives hard,
				// angular kinks at every bend. Fitting a smooth curve through them and
				// re-sampling at even arc-length spacing gives properly rounded turns
				// instead -- "centripetal" avoids the loops/overshoot ordinary Catmull-Rom
				// can produce on sharp real-world corners.
				let points = controlPoints;
				if(controlPoints.length > 2){
					const curve = new THREE.CatmullRomCurve3(
						controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z)),
						false, 'centripetal'
					);
					const curveLen = curve.getLength();
					const sampleCount = Math.min(1200, Math.max(controlPoints.length, Math.round(curveLen/3.5)));
					points = curve.getSpacedPoints(sampleCount).map(v => ({x: v.x, z: v.z}));
				}

				const cumDist = [0];
				for(let i = 1; i < points.length; i++) {
					const dx = points[i].x - points[i-1].x, dz = points[i].z - points[i-1].z;
					cumDist.push(cumDist[i-1] + Math.sqrt(dx*dx + dz*dz));
				}
				const totalLen = cumDist[cumDist.length - 1];
				if(totalLen < 1) return;

				routeRibbonGroup = new THREE.Group();
				const pathObj = { points, cumDist, totalLen };

				const ribbonRoadMat = new THREE.MeshStandardMaterial({color: roadMat.color, map: asphaltTextureRibbon, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide});
				const ribbonShoulderMat = new THREE.MeshStandardMaterial({color: shoulderMat.color, map: gravelTextureRibbon, roughness: 0.9, side: THREE.DoubleSide});

				const roadMesh = new THREE.Mesh(buildRibbonGeometry(points, ROAD_WIDTH, cumDist, 4), ribbonRoadMat);
				routeRibbonGroup.add(roadMesh);
				const shoulderMeshL = new THREE.Mesh(buildRibbonGeometry(points, ROAD_WIDTH + SHOULDER_WIDTH*2, cumDist, 4), ribbonShoulderMat);
				shoulderMeshL.position.y = -0.01;
				routeRibbonGroup.add(shoulderMeshL);

				// Direction at a point, measured over a fixed real-world lookahead rather
				// than however close two adjacent (downsampled) route points happen to be.
				// Using adjacent points directly could give a near-zero vector wherever the
				// route has closely-spaced points, which makes orientation unstable -- that's
				// almost certainly what was dropping trees/bushes onto the road.
				function directionAt(d) {
					const p0 = pointAtDistance(pathObj, d);
					const p1 = pointAtDistance(pathObj, Math.min(d + 2, totalLen));
					let dx = p1.x - p0.x, dz = p1.z - p0.z;
					const len = Math.sqrt(dx*dx + dz*dz);
					if(len < 0.05) { dx = 0; dz = -1; } // degenerate (e.g. right at the route's end) -- fall back to "ahead"
					return { p: p0, dx, dz };
				}

				// Real minimum distance from (x,z) to the route polyline as a whole -- not
				// just "at this point along the curve". A fixed lateral offset that's safely
				// clear of the road locally can still land near the road at a DIFFERENT point
				// along a tight or irregular bend, since the path can curve back toward itself.
				function distanceToPolyline(x, z) {
					let best = Infinity;
					for(let j = 0; j < points.length - 1; j++) {
						const a = points[j], b = points[j+1];
						const abx = b.x - a.x, abz = b.z - a.z;
						const lenSq = abx*abx + abz*abz || 1;
						let t = ((x - a.x)*abx + (z - a.z)*abz)/lenSq;
						t = Math.max(0, Math.min(1, t));
						const cx = a.x + abx*t, cz = a.z + abz*t;
						const d = Math.sqrt((x - cx)**2 + (z - cz)**2);
						if(d < best) best = d;
					}
					return best;
				}

				const sceneryClearance = TOTAL_SURFACE_WIDTH/2 + 1.2; // matches populateScenery's own minimum lateral offset
				function safeForScenery(p, dx, dz) {
					const len = Math.sqrt(dx*dx + dz*dz) || 1;
					const perpX = -dz/len, perpZ = dx/len;
					for(const side of [-1, 1]) {
						const ox = p.x + perpX*sceneryClearance*side;
						const oz = p.z + perpZ*sceneryClearance*side;
						if(distanceToPolyline(ox, oz) < TOTAL_SURFACE_WIDTH/2 + 0.3) return false;
					}
					return true;
				}

				// Dashed centre stripe -- previously one Group+Mesh PER dash (1000+
				// separate draw calls on a long route, a real performance cost).
				// Built as a single merged geometry instead: same visual, one draw call.
				const dashLen = 2, dashGap = 4;
				const dashPositions = [];
				const dashIndices = [];
				let dashVertCount = 0;
				for(let d = 0; d < totalLen; d += dashLen + dashGap) {
					const p0 = pointAtDistance(pathObj, d);
					const p1 = pointAtDistance(pathObj, Math.min(d + dashLen, totalLen));
					let dx = p1.x - p0.x, dz = p1.z - p0.z;
					const len = Math.sqrt(dx*dx + dz*dz) || 1;
					const px = -dz/len, pz = dx/len;
					const halfW = 0.09;
					const a = [p0.x - px*halfW, 0.006, p0.z - pz*halfW];
					const b = [p0.x + px*halfW, 0.006, p0.z + pz*halfW];
					const c = [p1.x - px*halfW, 0.006, p1.z - pz*halfW];
					const dd = [p1.x + px*halfW, 0.006, p1.z + pz*halfW];
					dashPositions.push(...a, ...b, ...c, ...dd);
					const i0 = dashVertCount;
					dashIndices.push(i0, i0+1, i0+2,  i0+1, i0+3, i0+2);
					dashVertCount += 4;
				}
				if(dashPositions.length){
					const dashGeom = new THREE.BufferGeometry();
					dashGeom.setAttribute('position', new THREE.Float32BufferAttribute(dashPositions, 3));
					dashGeom.setIndex(dashIndices);
					dashGeom.computeVertexNormals();
					routeRibbonGroup.add(new THREE.Mesh(dashGeom, stripeMat));
				}

				// Roadside scenery -- reuses the exact same populateScenery() the procedural
				// road uses (trees, rocks, bushes, fences, lamps, signs, water, sheep), just
				// wrapped in a group oriented to the path's local direction at each point,
				// so fences/signs naturally follow the road's real curves too. Skipped
				// wherever it would land near the road at some OTHER point along a bend.
				const spacing = Math.max(16, totalLen/300);
				for(let d = spacing; d < totalLen - spacing/2; d += spacing) {
					const {p, dx, dz} = directionAt(d);
					if(!safeForScenery(p, dx, dz)) continue;
					const sceneryWrap = new THREE.Group();
					sceneryWrap.position.set(p.x, 0, p.z);
					sceneryWrap.lookAt(p.x + dx, 0, p.z + dz);
					routeRibbonGroup.add(sceneryWrap);
					populateScenery(sceneryWrap, d);
				}

				scene.add(routeRibbonGroup);
				routeCameraPath = pathObj;

				// Hide the infinite procedural road and the rival while a real route is active.
				segments.forEach(s => { s.group.visible = false; });
				rivalGroup.visible = false;
			}

			function pointAtDistance(path, meters) {
				const clamped = Math.max(0, Math.min(meters, path.totalLen));
				let i = 0;
				while(i < path.cumDist.length - 1 && path.cumDist[i+1] < clamped) i++;
				const segStart = path.cumDist[i], segEnd = path.cumDist[i+1] !== undefined ? path.cumDist[i+1] : segStart;
				const t = segEnd > segStart ? (clamped - segStart)/(segEnd - segStart) : 0;
				const a = path.points[i], b = path.points[i+1] || a;
				return { x: a.x + (b.x - a.x)*t, z: a.z + (b.z - a.z)*t };
			}

			build3DRoute = buildRouteRibbon;
			clear3DRoute = clearRouteRibbon;

			// ---------- Time-of-day lighting ----------
			// Sky, fog, and lighting shift smoothly based on the real device clock --
			// warm low light at dawn/dusk, bright neutral light at midday, dim cool
			// light at night with the lamp posts actually glowing. Keyframes are
			// interpolated between, not snapped, so there's no jarring jump.
			const timeKeyframes = [
				{h: 0,    skyTop:'#16224a', skyMid:'#243a68', skyHorizon:'#324a76', sun:'#8fa8ff', sunI:0.45, hemiSky:'#3a5080', hemiGround:'#1c3324', hemiI:0.62, elev:-10, lamp:2.2},
				{h: 5,    skyTop:'#1c2c54', skyMid:'#2c4270', skyHorizon:'#3c4a7c', sun:'#9ab0e0', sunI:0.48, hemiSky:'#3f5888', hemiGround:'#22392c', hemiI:0.65, elev:-5,  lamp:2.0},
				{h: 6.5,  skyTop:'#3a5a8c', skyMid:'#a878a0', skyHorizon:'#f4a463', sun:'#ffb37a', sunI:0.72, hemiSky:'#8894b8', hemiGround:'#3a2c22', hemiI:0.72, elev:6,   lamp:1.1},
				{h: 9,    skyTop:'#4f8fd6', skyMid:'#a9d4ec', skyHorizon:'#ffe0b0', sun:'#fff0d0', sunI:1.05, hemiSky:'#a9d4ec', hemiGround:'#4d6e43', hemiI:0.95, elev:35,  lamp:0.15},
				{h: 13,   skyTop:'#3f7fd0', skyMid:'#a9d4ec', skyHorizon:'#dcedf5', sun:'#ffffff', sunI:1.25, hemiSky:'#ffffff', hemiGround:'#4d6e43', hemiI:1.0,  elev:70,  lamp:0.05},
				{h: 17,   skyTop:'#4f8fd6', skyMid:'#c3d9ea', skyHorizon:'#f5dcc0', sun:'#ffe8c0', sunI:1.1,  hemiSky:'#b8c8dc', hemiGround:'#4d5e38', hemiI:0.9,  elev:40,  lamp:0.1},
				{h: 19,   skyTop:'#2a3a6a', skyMid:'#a85a5a', skyHorizon:'#ff8a4c', sun:'#ff8a4c', sunI:0.62, hemiSky:'#5a6a98', hemiGround:'#3a2c1e', hemiI:0.55, elev:8,   lamp:1.0},
				{h: 21,   skyTop:'#1c2848', skyMid:'#2c2f5c', skyHorizon:'#3c3e70', sun:'#8a7aa8', sunI:0.46, hemiSky:'#3a4270', hemiGround:'#1a2824', hemiI:0.6,  elev:-8,  lamp:1.9},
				{h: 24,   skyTop:'#16224a', skyMid:'#243a68', skyHorizon:'#324a76', sun:'#8fa8ff', sunI:0.45, hemiSky:'#3a5080', hemiGround:'#1c3324', hemiI:0.62, elev:-10, lamp:2.2}
			];

			function lerp(a, b, t){ return a + (b - a)*t; }
			function lerpHex(hexA, hexB, t){
				const ca = new THREE.Color(hexA), cb = new THREE.Color(hexB);
				return ca.lerp(cb, t);
			}
			function smooth01(x){ return Math.max(0, Math.min(1, x)); }

			// Sun and moon as simple glow sprites (radial-gradient canvas textures,
			// always face the camera, ignore fog/depth so they read as "in the sky"
			// rather than scene geometry). Positioned far away on a fixed arc and
			// faded in/out based on the same elevation angle driving the lighting.
			function makeGlowTexture(core, glow){
				const c = document.createElement('canvas');
				c.width = 128; c.height = 128;
				const ctx = c.getContext('2d');
				const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
				grad.addColorStop(0, core);
				grad.addColorStop(0.32, core);
				grad.addColorStop(0.55, glow);
				grad.addColorStop(1, 'rgba(0,0,0,0)');
				ctx.fillStyle = grad;
				ctx.fillRect(0, 0, 128, 128);
				return ctx;
			}
			const sunCtx = makeGlowTexture('rgba(255,250,230,1)', 'rgba(255,215,140,0.5)');
			const sunTexture = new THREE.CanvasTexture(sunCtx.canvas);
			const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({map: sunTexture, transparent: true, depthTest: false, depthWrite: false, fog: false}));
			sunSprite.scale.set(46, 46, 1);
			scene.add(sunSprite);

			const moonCtx = makeGlowTexture('rgba(232,238,250,1)', 'rgba(170,195,225,0.35)');
			// A couple of soft craters for a little character
			moonCtx.fillStyle = 'rgba(180,195,215,0.5)';
			moonCtx.beginPath(); moonCtx.arc(50, 46, 9, 0, Math.PI*2); moonCtx.fill();
			moonCtx.beginPath(); moonCtx.arc(76, 70, 6, 0, Math.PI*2); moonCtx.fill();
			const moonTexture = new THREE.CanvasTexture(moonCtx.canvas);
			const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({map: moonTexture, transparent: true, depthTest: false, depthWrite: false, fog: false}));
			moonSprite.scale.set(32, 32, 1);
			scene.add(moonSprite);

			function applyTimeOfDay(){
				const now = new Date();
				const hour = now.getHours() + now.getMinutes()/60;

				let k0 = timeKeyframes[0], k1 = timeKeyframes[timeKeyframes.length - 1];
				for(let i = 0; i < timeKeyframes.length - 1; i++){
					if(hour >= timeKeyframes[i].h && hour <= timeKeyframes[i+1].h){
						k0 = timeKeyframes[i]; k1 = timeKeyframes[i+1]; break;
					}
				}
				const span = k1.h - k0.h;
				const t = span > 0 ? (hour - k0.h)/span : 0;

				const skyTop = lerpHex(k0.skyTop, k1.skyTop, t);
				const skyMid = lerpHex(k0.skyMid, k1.skyMid, t);
				const skyHorizon = lerpHex(k0.skyHorizon, k1.skyHorizon, t);
				paintSky('#' + skyTop.getHexString(), '#' + skyMid.getHexString(), '#' + skyHorizon.getHexString());

				currentFog.color.copy(skyHorizon);

				const sunColor = lerpHex(k0.sun, k1.sun, t);
				sun.color.copy(sunColor);
				sun.intensity = lerp(k0.sunI, k1.sunI, t);
				const elev = lerp(k0.elev, k1.elev, t);
				const elevRad = elev*Math.PI/180;
				sun.position.set(40, Math.max(3, Math.sin(elevRad)*90 + 20), -20 - Math.cos(elevRad)*30);

				hemiLight.color.copy(lerpHex(k0.hemiSky, k1.hemiSky, t));
				hemiLight.groundColor.copy(lerpHex(k0.hemiGround, k1.hemiGround, t));
				hemiLight.intensity = lerp(k0.hemiI, k1.hemiI, t);

				lampHeadMat.emissiveIntensity = lerp(k0.lamp, k1.lamp, t);

				// Sun rises/sets on one side of the sky; moon takes roughly the
				// opposite arc, so as one fades out the other fades in.
				const skyDist = 320;
				const sunElevRad = elev*Math.PI/180;
				sunSprite.position.set(70, Math.sin(sunElevRad)*180 + 40, -skyDist);
				sunSprite.material.opacity = smooth01((elev + 6)/14);

				const moonElev = -elev - 4;
				const moonElevRad = moonElev*Math.PI/180;
				moonSprite.position.set(-70, Math.sin(moonElevRad)*180 + 40, -skyDist);
				moonSprite.material.opacity = smooth01((moonElev + 6)/14)*0.9;
			}
			applyTimeOfDay();
			setInterval(applyTimeOfDay, 60000); // real time keeps moving during a long ride

			// ---------- Rival cyclist ----------
			// Holds a steady pace; you catch up when you're pedalling harder. Kept
			// procedural-mode only (like before) -- it's a single cheap entity, not
			// the source of the slowdown, so no need to touch it.
			const LANE_OFFSET = ROAD_WIDTH/4;
			const rivalGroup = new THREE.Group();
			const rivalFrame = new THREE.Mesh(
				new THREE.BoxGeometry(0.08, 0.5, 1.1),
				new THREE.MeshStandardMaterial({color: 0xdd4433, roughness: 0.5, metalness: 0.3})
			);
			rivalFrame.position.y = 0.75;
			rivalFrame.rotation.x = 0.25;
			const rivalWheelGeom = new THREE.TorusGeometry(0.35, 0.045, 6, 12);
			const rivalWheelMat = new THREE.MeshStandardMaterial({color: 0x111111, roughness: 0.7});
			const rivalWheelFront = new THREE.Mesh(rivalWheelGeom, rivalWheelMat);
			rivalWheelFront.position.set(0, 0.35, -0.5);
			const rivalWheelBack = new THREE.Mesh(rivalWheelGeom, rivalWheelMat);
			rivalWheelBack.position.set(0, 0.35, 0.5);
			const rivalRider = new THREE.Mesh(
				new THREE.SphereGeometry(0.22, 8, 6),
				new THREE.MeshStandardMaterial({color: 0x2255aa, roughness: 0.6})
			);
			rivalRider.position.set(0, 1.25, -0.1);
			rivalGroup.add(rivalFrame, rivalWheelFront, rivalWheelBack, rivalRider);
			rivalGroup.position.set(-LANE_OFFSET, 0, -70);
			scene.add(rivalGroup);
			const RIVAL_OWN_SPEED = (13*1000/3600)*VISUAL_SCALE; // steady ~13km/h pace

			function resize() {
				const w = container.clientWidth, h = container.clientHeight;
				if(!w || !h) return;
				camera.aspect = w/h;
				camera.updateProjectionMatrix();
				renderer.setSize(w, h);
			}

			window.addEventListener('resize', resize);

			const clock = new THREE.Clock();

			function animate() {
				requestAnimationFrame(animate);
				const dt = Math.min(clock.getDelta(), 0.1);
				const speedKmh = isRiding ? (lastSpeed || 0) : 0;
				const speedMS = (speedKmh*1000)/3600;
				const visualSpeed = speedMS*VISUAL_SCALE;
				currentWorldProgress += visualSpeed*dt;
				// Adjust environment atmosphere instantly to project extreme speed levels
				const speedRatio = Math.min(speedKmh/50, 1.5); // Normalized scalar up to 75kmh
				currentFog.near = baseFogNear - (speedRatio*12);
				currentFog.far = baseFogFar - (speedRatio*45);
				camera.fov = BASE_FOV + (speedRatio*16); // Dynamic FOV zoom out
				camera.updateProjectionMatrix();

				// A real route travels true meters, easily hundreds+ from the origin,
				// so the ground plane must follow the camera rather than sit fixed --
				// otherwise you'd ride straight off the edge of it within a minute.
				baseGround.position.x = camera.position.x;
				baseGround.position.z = camera.position.z;

				// Each segment scrolls toward the camera every frame. Its "true" position
				// along the infinite procedural path is (local z) - (total distance travelled),
				// which stays stable forever since both grow by the same amount each frame --
				// no loop-counting needed, and it doubles as a stable seed for curve/elevation.
				// All of this (and traffic/rival) only runs in procedural mode -- a real
				// route replaces it with a fixed ribbon the camera travels along instead.
				if(!routeCameraPath){
					segments.forEach(seg => {
						seg.group.position.z += visualSpeed*dt;

						const worldZ = seg.group.position.z - currentWorldProgress;
						const layout = getRoadLayout(worldZ);
						seg.group.position.x = layout.x;
						seg.group.position.y = layout.y;

						if(seg.group.position.z > 20) {
							seg.group.position.z -= totalLen;
							const recycledWorldZ = seg.group.position.z - currentWorldProgress;
							populateScenery(seg.scenery, recycledWorldZ);
						}
					});

					// Rival cyclist holds a steady pace -- you visibly close the gap
					// (or fall behind) depending on how hard you're actually pedalling.
					// Frozen entirely until a ride is active.
					if(isRiding){
						rivalGroup.position.z += (visualSpeed - RIVAL_OWN_SPEED)*dt;
						rivalGroup.children.forEach(c => { if(c.geometry && c.geometry.type === 'TorusGeometry') c.rotation.x += visualSpeed*dt*1.6; });
						if(rivalGroup.position.z > 15){
							rivalGroup.position.z = -120 - Math.random()*40;
						}
					}
				}


				if(routeCameraPath && isRiding){
					// Real route mode: camera position comes directly from the same
					// `distanceKm` that already drives the 2D map marker -- true
					// distance along the actual route, not an abstract visual speed.
					const distM = distanceKm*1000;
					const pos = pointAtDistance(routeCameraPath, distM);
					const lookPos = pointAtDistance(routeCameraPath, distM + 12);
					ride3dBobPhase += dt*(3.5 + visualSpeed*0.8);
					const bobValue = Math.sin(ride3dBobPhase)*(0.022 + speedRatio*0.01);
					camera.position.set(pos.x, BASE_CAM_Y + bobValue, pos.z);
					camera.rotation.z = 0;
					camera.lookAt(lookPos.x, BASE_CAM_Y*0.8, lookPos.z);
				}
				else if(!routeCameraPath && visualSpeed > 0.05) {
					// Straight procedural road: camera just stays centered -- only a
					// small vertical bob for pedalling feel, no sideways movement at all.
					ride3dBobPhase += dt*(3.5 + visualSpeed*0.8); // micro-vibrations + pedalling rhythm
					const bobValue = Math.sin(ride3dBobPhase)*(0.022 + speedRatio*0.01);
					const microVibration = (Math.random() - 0.5)*(speedRatio*0.009);
					camera.position.y = BASE_CAM_Y + bobValue + microVibration;
					camera.position.x = 0;
					camera.rotation.z = 0;
					camera.lookAt(0, BASE_CAM_Y*0.8, -18);
				}
				else if(routeCameraPath && !isRiding){
				const startPos = pointAtDistance(routeCameraPath, 0);
				const lookPos = pointAtDistance(routeCameraPath, 12);
				camera.position.set(startPos.x, BASE_CAM_Y, startPos.z);
				camera.rotation.z = 0;
				camera.lookAt(lookPos.x, BASE_CAM_Y*0.8, lookPos.z);
			}
			else if(!routeCameraPath) { // Return smoothly to standard idle positions when wheel stop tracking kicks in
					camera.position.set(0, BASE_CAM_Y, 8);
					camera.rotation.z = 0;
					camera.lookAt(0, BASE_CAM_Y*0.8, -18);
				}
				renderer.render(scene, camera);
			}

			animate();
		}


		init3D();
