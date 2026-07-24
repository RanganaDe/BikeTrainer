		// ---------- state ----------
		let device = null, server = null;
		let usingFTMS = false;
		let lastPower = null;
		let lastSpeed = null;
		let lastCadence = null; // also read by the 3D avatar to drive pedalling speed
		let lastSpeedTs = null;
		let prevWheelRevs = null, prevWheelEventTime = null;

		let isRiding = false;
		let isPaused = false;
		let rideStartTs = null;
		let timerInterval = null;
		let powerSum = 0, powerCount = 0, powerMax = 0;
		let distanceKm = 0;
		let lastCalories = null; // latest FTMS total-energy reading (kcal); recorded onto the ride entry on stop

		function setStatus(state, label) {
			els.statusText.textContent = label || state;
			els.statusDot.classList.toggle('live', state === 'connected');
		}

		// Live metrics are shown only in the ride-view HUD now (the old standalone
		// readout tiles were removed). The raw FTMS fields still appear in the ▤ packet log.
		function updatePower(watts) {
			lastPower = watts;
			if(els.hudPower) els.hudPower.textContent = Math.round(watts);
			if(isRiding && !isPaused) {
				powerSum += watts;
				powerCount++;
				if(watts > powerMax) powerMax = watts;
			}
		}

		function updateSpeed(kmh) {
			const now = performance.now();
			if(isRiding && !isPaused && lastSpeedTs !== null) {
				const deltaHours = (now - lastSpeedTs)/3600000;
				distanceKm += kmh*deltaHours;
				if(routeActive) updateRouteProgress(distanceKm);
			}
			lastSpeed = kmh;
			lastSpeedTs = now;
			if(els.hudSpeed) els.hudSpeed.textContent = kmh.toFixed(1);
			if(els.hudDistance && isRiding) els.hudDistance.textContent = distanceKm.toFixed(1);
		}

		function updateCadence(rpm) {
			lastCadence = rpm;
			if(els.hudCadence) els.hudCadence.textContent = Math.round(rpm);
		}

		// FTMS reports cumulative energy; keep the latest so the finished ride can log it.
		function updateCalories(kcal) {
			lastCalories = kcal;
		}
