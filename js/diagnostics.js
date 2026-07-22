		els.settingsBtn.addEventListener('click', () => {
			els.settingsPanel.classList.toggle('show');
		});

		// ---------- raw packet debug log ----------
		const DEBUG_MAX = 100;
		let debugEntries = [];

		function hexOf(dv) {
			let parts = [];
			for(let i = 0; i < dv.byteLength; i++) {
				parts.push(dv.getUint8(i).toString(16).padStart(2, '0'));
			}
			return parts.join(' ');
		}

		function logPacket(source, dv, summary) {
			const t = new Date().toLocaleTimeString(undefined, {hour12: false});
			debugEntries.unshift({t, source, hex: hexOf(dv), summary});
			if(debugEntries.length > DEBUG_MAX) debugEntries.length = DEBUG_MAX;
			renderDebug();
		}

		function logEvent(source, summary) {
			const t = new Date().toLocaleTimeString(undefined, {hour12: false});
			debugEntries.unshift({t, source, hex: '', summary});
			if(debugEntries.length > DEBUG_MAX) debugEntries.length = DEBUG_MAX;
			renderDebug();
		}

		function renderDebug() {
			if(!els.debugPanel.classList.contains('show')) return; // skip the DOM rebuild while hidden -- this runs on every BLE packet
			if(debugEntries.length === 0) {
				els.debugList.innerHTML = `<div class="debug-empty">No packets yet — connect and start pedaling.</div>`;
				return;
			}
			els.debugList.innerHTML = debugEntries.map(e => `
      <div class="debug-row">
        <span class="debug-t">${e.t}</span>
        <span class="debug-src">${e.source}</span>
        <span>${e.hex}</span>
        <span class="debug-detail">${e.summary}</span>
      </div>`).join('');
		}

		renderDebug();

		els.debugBtn.addEventListener('click', () => {
			els.debugPanel.classList.toggle('show');
			renderDebug();
		});

		els.debugClear.addEventListener('click', () => {
			debugEntries = [];
			renderDebug();
		});

		els.debugCopy.addEventListener('click', async () => {
			const text = debugEntries.slice().reverse().map(e =>
				`${e.t}  ${e.source}${e.hex ? '  raw=' + e.hex : ''}  ${e.summary}`
			).join('\n');
			try {
				await navigator.clipboard.writeText(text || 'No packets logged yet.');
				els.debugCopy.textContent = 'Copied';
				setTimeout(() => {
					els.debugCopy.textContent = 'Copy';
				}, 1200);
			} catch(e) {
				alert('Could not copy — select and copy manually.');
			}
		});

		// ---------- bluetooth support check ----------
		function isIOSDevice() {
			// iPhones/iPods report clearly; iPadOS 13+ disguises itself as "MacIntel" but
			// is touch-capable, which real Macs are not.
			return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
				(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		}

		if(!navigator.bluetooth) {
			if(isIOSDevice()) {
				els.unsupportedBanner.innerHTML =
					`Apple blocks Web Bluetooth in every browser on iOS/iPadOS, including Chrome — even here it's still running Safari's engine under the hood. ` +
					`To connect your sensor on this device, open this page in <a href="https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener">Bluefy – Web BLE Browser</a> (a free app), ` +
					`or install the <a href="https://apps.apple.com/us/app/ioswebble/id6761301368" target="_blank" rel="noopener">ioswebble</a> Safari extension and use Safari instead (requires iOS 26+).`;
			} else {
				els.unsupportedBanner.textContent =
					"This browser doesn't support Web Bluetooth. Open this page in Chrome or Edge on desktop or Android to connect to your sensor.";
			}
			els.unsupportedBanner.classList.add('show');
			els.connectBtn.disabled = true;
		}
