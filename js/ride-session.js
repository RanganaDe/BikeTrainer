		// ---------- ride session ----------
		function startRide() {
			isRiding = true;
			rideStartTs = Date.now();
			powerSum = 0;
			powerCount = 0;
			powerMax = 0;
			distanceKm = 0;
			lastSpeedTs = performance.now();
			if(routeActive) updateRouteProgress(0);
			els.rideBtn.textContent = 'Stop ride';
			els.rideBtn.classList.add('stop');
			els.rideBtn.classList.remove('primary');
			els.timerDisplay.classList.add('active');
			timerInterval = setInterval(() => {
				const sec = Math.floor((Date.now() - rideStartTs)/1000);
				els.timerDisplay.textContent = fmtDuration(sec);
			}, 1000);
		}

		function stopRide() {
			isRiding = false;
			clearInterval(timerInterval);
			const duration = Math.floor((Date.now() - rideStartTs)/1000);
			els.rideBtn.textContent = 'Start ride';
			els.rideBtn.classList.remove('stop');
			els.rideBtn.classList.add('primary');
			els.timerDisplay.classList.remove('active');

			if(duration >= 5) {
				const caloriesText = els.caloriesValue.textContent;
				const entry = {
					ts: rideStartTs,
					duration,
					avgPower: powerCount ? Math.round(powerSum/powerCount) : 0,
					maxPower: Math.round(powerMax),
					distanceKm: distanceKm,
					caloriesKcal: caloriesText && caloriesText !== '–' ? Number(caloriesText) : null,
				};
				if(routeActive) {
					entry.routeFrom = routeFromLabel;
					entry.routeTo = routeToLabel;
					entry.routeTotalKm = routeTotalKm;
					entry.routeCoveredKm = Math.min(distanceKm, routeTotalKm);
					entry.routeCoords = downsampleCoords(routeCoords, 80);
				}
				const list = loadHistory();
				list.push(entry);
				saveHistory(list);
				renderHistory();
				if(currentUser) pushRideToCloud(entry);
			}
			els.timerDisplay.textContent = '00:00';
		}

		els.rideBtn.addEventListener('click', () => {
			if(isRiding) stopRide(); else startRide();
			els.simulateBtn.disabled = isRiding;
		});

		// ---------- ride simulator (for testing without a real sensor) ----------
		// Feeds fake telemetry through the exact same updateSpeed/updatePower/updateCadence
		// functions real BLE packets use, so everything downstream -- 3D view, stats tiles,
		// ride log, cloud sync -- behaves identically to a real ride.
		let simInterval = null;
		let simPhase = 0;
		let isSimulating = false;

		function simulateTick(){
			if(!isRiding){ stopSimulation(); return; } // ride ended some other way -- clean up
			simPhase += 1;
			const t = simPhase*0.5;
			const speedKmh = Math.max(0, 20 + Math.sin(t*0.15)*7 + Math.sin(t*0.6)*2 + (Math.random()-0.5)*1.5);
			const powerW = Math.max(0, Math.round(140 + Math.sin(t*0.15)*60 + Math.sin(t*0.6)*20 + (Math.random()-0.5)*15));
			const cadence = Math.max(0, Math.round(62 + Math.sin(t*0.2)*15 + (Math.random()-0.5)*4));
			updateSpeed(speedKmh);
			updatePower(powerW);
			updateCadence(cadence);
		}

		function startSimulation(){
			isSimulating = true;
			simPhase = 0;
			simInterval = setInterval(simulateTick, 250);
			els.simulateBtn.textContent = 'Stop simulation';
			els.simulateBtn.classList.add('stop');
			els.rideBtn.disabled = true;
		}

		function stopSimulation(){
			isSimulating = false;
			if(simInterval){ clearInterval(simInterval); simInterval = null; }
			els.simulateBtn.textContent = 'Simulate ride';
			els.simulateBtn.classList.remove('stop');
			els.rideBtn.disabled = !(device && device.gatt && device.gatt.connected);
		}

		els.simulateBtn.addEventListener('click', () => {
			if(isSimulating){
				stopRide();
				stopSimulation();
			} else if(!isRiding){
				startRide();
				startSimulation();
			}
		});
