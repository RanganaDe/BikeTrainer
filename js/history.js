		// ---------- persistence ----------
		const WHEEL_KEY = 'bike_tracker_wheel_mm';
		const HISTORY_KEY = 'bike_tracker_history';

		const savedWheel = localStorage.getItem(WHEEL_KEY);
		if(savedWheel) els.wheelCirc.value = savedWheel;
		els.wheelCirc.addEventListener('change', () => {
			localStorage.setItem(WHEEL_KEY, els.wheelCirc.value);
		});

		function loadHistory() {
			try {
				return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
			} catch(e) {
				return [];
			}
		}

		function saveHistory(list) {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
		}

		function fmtDate(ts) {
			const d = new Date(ts);
			const date = d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
			const time = d.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
			return {date, time};
		}

		function fmtDuration(sec) {
			const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
			if(h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
			return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		}

		function renderHistory() {
			const list = loadHistory();
			if(list.length === 0) {
				els.logList.innerHTML = `<div class="log-empty">No rides logged yet — connect your sensor and hit start.</div>`;
				return;
			}
			const sorted = [...list].sort((a, b) => b.ts - a.ts);
			els.logList.innerHTML = sorted.map((r, i) => {
				const {date, time} = fmtDate(r.ts);
				const idx = String(sorted.length - i).padStart(2, '0');
				const shownKm = r.routeCoveredKm != null ? r.routeCoveredKm : r.distanceKm;
				const routeBadge = r.routeFrom
					? `<span class="log-route-badge">↝ ${escapeHtml(r.routeFrom)} → ${escapeHtml(r.routeTo)} (${r.routeTotalKm.toFixed(1)}km)</span>`
					: '';
				return `<div class="log-row">
        <div class="log-idx">${idx}</div>
        <div class="log-date">${date}<span class="time">${time} · ${fmtDuration(r.duration)}</span>${routeBadge}</div>
        <div class="log-stats"><b>${r.avgPower}</b>W avg &nbsp;·&nbsp; <b>${shownKm.toFixed(1)}</b>km</div>
        <button class="log-share-btn" data-ts="${r.ts}">Share</button>
      </div>`;
			}).join('');
		}

		renderHistory();

		els.logList.addEventListener('click', (e) => {
			const btn = e.target.closest('.log-share-btn');
			if(!btn) return;
			const ts = Number(btn.dataset.ts);
			const entry = loadHistory().find(r => r.ts === ts);
			if(entry) shareRide(entry, btn);
		});

		els.clearLog.addEventListener('click', () => {
			if(confirm('Clear all saved rides? This can\'t be undone.')) {
				saveHistory([]);
				renderHistory();
			}
		});
