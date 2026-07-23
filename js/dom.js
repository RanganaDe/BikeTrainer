		const POWER_SCALE_MAX = 400; // watts mapped to full ring
		const RING_CIRC = 2*Math.PI*65;

		const els = {
			statusDot: document.getElementById('statusDot'),
			statusText: document.getElementById('statusText'),
			connectBtn: document.getElementById('connectBtn'),
			settingsBtn: document.getElementById('settingsBtn'),
			settingsPanel: document.getElementById('settingsPanel'),
			wheelCirc: document.getElementById('wheelCirc'),
			debugBtn: document.getElementById('debugBtn'),
			debugPanel: document.getElementById('debugPanel'),
			debugList: document.getElementById('debugList'),
			debugCopy: document.getElementById('debugCopy'),
			debugClear: document.getElementById('debugClear'),
			unsupportedBanner: document.getElementById('unsupportedBanner'),
			powerValue: document.getElementById('powerValue'),
			speedValue: document.getElementById('speedValue'),
			powerRing: document.getElementById('powerRing'),
			cadenceValue: document.getElementById('cadenceValue'),
			distanceValue: document.getElementById('distanceValue'),
			resistanceValue: document.getElementById('resistanceValue'),
			caloriesValue: document.getElementById('caloriesValue'),
			elapsedValue: document.getElementById('elapsedValue'),
			routeFrom: document.getElementById('routeFrom'),
			routeTo: document.getElementById('routeTo'),
			findRouteBtn: document.getElementById('findRouteBtn'),
			routeStatus: document.getElementById('routeStatus'),
			streetNameLabel: document.getElementById('streetNameLabel'),
			poiNameLabel: document.getElementById('poiNameLabel'),
			resistanceSuggestLabel: document.getElementById('resistanceSuggestLabel'),
			rideProgressLabel: document.getElementById('rideProgressLabel'),
			hudPower: document.getElementById('hudPower'),
			hudCadence: document.getElementById('hudCadence'),
			hudSpeed: document.getElementById('hudSpeed'),
			hudDistance: document.getElementById('hudDistance'),
			hudTime: document.getElementById('hudTime'),
			miniMapWrap: document.getElementById('miniMapWrap'),
			ride3dCanvas: document.getElementById('ride3dCanvas'),
			followToggle: document.getElementById('followToggle'),
			accountBar: document.getElementById('accountBar'),
			accountAvatar: document.getElementById('accountAvatar'),
			accountName: document.getElementById('accountName'),
			authBtn: document.getElementById('authBtn'),
			rideBtn: document.getElementById('rideBtn'),
			pauseBtn: document.getElementById('pauseBtn'),
			simulateBtn: document.getElementById('simulateBtn'),
			timerDisplay: document.getElementById('timerDisplay'),
			logList: document.getElementById('logList'),
			clearLog: document.getElementById('clearLog'),
		};

		els.powerRing.style.strokeDasharray = RING_CIRC;
		els.powerRing.style.strokeDashoffset = RING_CIRC;

		function escapeHtml(str) {
			return String(str).replace(/[&<>"']/g, c => ({
				'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
			}[c]));
		}
