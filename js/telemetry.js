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

		function setStatus(state, label) {
			els.statusText.textContent = label || state;
			els.statusDot.classList.toggle('live', state === 'connected');
		}

		function updatePower(watts) {
			lastPower = watts;
			els.powerValue.textContent = Math.round(watts);
			if(els.hudPower) els.hudPower.textContent = Math.round(watts);
			const frac = Math.max(0, Math.min(1, watts/POWER_SCALE_MAX));
			els.powerRing.style.strokeDashoffset = RING_CIRC*(1 - frac);
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
			els.speedValue.textContent = kmh.toFixed(1);
			if(els.hudSpeed) els.hudSpeed.textContent = kmh.toFixed(1);
			if(els.hudDistance && isRiding) els.hudDistance.textContent = distanceKm.toFixed(1);
		}

		function updateCadence(rpm) {
			lastCadence = rpm;
			els.cadenceValue.textContent = Math.round(rpm);
			if(els.hudCadence) els.hudCadence.textContent = Math.round(rpm);
		}

		function updateBikeDistance(meters) {
			els.distanceValue.textContent = (meters/1000).toFixed(2);
		}

		function updateResistance(level) {
			els.resistanceValue.textContent = level;
		}

		function updateCalories(kcal) {
			els.caloriesValue.textContent = kcal;
		}

		function updateBikeElapsed(sec) {
			els.elapsedValue.textContent = fmtDuration(sec);
		}
