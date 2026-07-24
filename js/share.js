		// ---------- share ride as an image (Instagram Story sized) ----------
		async function buildShareCanvas(entry) {
			if(document.fonts && document.fonts.ready) {
				try {
					await document.fonts.ready;
				} catch(e) {
				}
			}
			const W = 1080, H = 1920;
			const canvas = document.createElement('canvas');
			canvas.width = W;
			canvas.height = H;
			const ctx = canvas.getContext('2d');

			const bg = ctx.createLinearGradient(0, 0, 0, H);
			bg.addColorStop(0, '#171b1f');
			bg.addColorStop(1, '#101316');
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, W, H);

			const glowA = ctx.createRadialGradient(W*0.15, H*0.04, 0, W*0.15, H*0.04, W*0.65);
			glowA.addColorStop(0, 'rgba(244,196,48,0.10)');
			glowA.addColorStop(1, 'rgba(244,196,48,0)');
			ctx.fillStyle = glowA;
			ctx.fillRect(0, 0, W, H);

			const glowB = ctx.createRadialGradient(W*0.92, H*0.02, 0, W*0.92, H*0.02, W*0.55);
			glowB.addColorStop(0, 'rgba(77,200,255,0.09)');
			glowB.addColorStop(1, 'rgba(77,200,255,0)');
			ctx.fillStyle = glowB;
			ctx.fillRect(0, 0, W, H);

			ctx.textBaseline = 'alphabetic';
			ctx.fillStyle = '#7c848c';
			ctx.font = '600 30px "Space Grotesk", sans-serif';
			ctx.fillText('CADENCE LOG', 70, 110);

			const d = new Date(entry.ts);
			ctx.fillStyle = '#ecedef';
			ctx.font = '500 30px "Space Grotesk", sans-serif';
			ctx.fillText(d.toLocaleDateString(undefined, {month: 'long', day: 'numeric', year: 'numeric'}), 70, 152);

			const shownKm = entry.routeCoveredKm != null ? entry.routeCoveredKm : entry.distanceKm;
			ctx.fillStyle = '#4dc8ff';
			ctx.font = '700 170px "JetBrains Mono", monospace';
			ctx.fillText(shownKm.toFixed(1), 70, 420);
			ctx.fillStyle = '#7c848c';
			ctx.font = '600 40px "Space Grotesk", sans-serif';
			ctx.fillText('KILOMETERS', 74, 470);

			function statBlock(x, y, label, value, color) {
				ctx.fillStyle = color;
				ctx.font = '700 66px "JetBrains Mono", monospace';
				ctx.fillText(value, x, y);
				ctx.fillStyle = '#7c848c';
				ctx.font = '600 25px "Space Grotesk", sans-serif';
				ctx.fillText(label, x, y + 38);
			}

			statBlock(70, 630, 'AVG POWER (W)', String(entry.avgPower), '#f4c430');
			statBlock(560, 630, 'MAX POWER (W)', String(entry.maxPower), '#f4c430');
			statBlock(70, 770, 'DURATION', fmtDuration(entry.duration), '#ecedef');
			statBlock(560, 770, 'CALORIES', entry.caloriesKcal != null ? String(entry.caloriesKcal) : '—', '#ecedef');

			if(entry.routeCoords && entry.routeCoords.length > 1) {
				let y = 930;
				ctx.fillStyle = '#7c848c';
				ctx.font = '600 26px "Space Grotesk", sans-serif';
				ctx.fillText('ROUTE', 70, y);

				const boxX = 70, boxY = y + 30, boxW = W - 140, boxH = 460, pad = 36;
				const lats = entry.routeCoords.map(c => c.lat);
				const lngs = entry.routeCoords.map(c => c.lng);
				const minLat = Math.min(...lats), maxLat = Math.max(...lats);
				const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
				const meanLat = (minLat + maxLat)/2*Math.PI/180;
				const spanLat = Math.max(maxLat - minLat, 1e-6);
				const spanLng = Math.max(maxLng - minLng, 1e-6);
				const scale = Math.min(
					(boxW - pad*2)/(spanLng*Math.cos(meanLat)),
					(boxH - pad*2)/spanLat
				);
				const usedW = spanLng*Math.cos(meanLat)*scale;
				const usedH = spanLat*scale;
				const offX = boxX + pad + (boxW - pad*2 - usedW)/2;
				const offY = boxY + pad + (boxH - pad*2 - usedH)/2;
				const proj = c => [
					offX + (c.lng - minLng)*Math.cos(meanLat)*scale,
					offY + (maxLat - c.lat)*scale
				];

				ctx.strokeStyle = '#4dc8ff';
				ctx.lineWidth = 7;
				ctx.lineJoin = 'round';
				ctx.lineCap = 'round';
				ctx.beginPath();
				entry.routeCoords.forEach((c, i) => {
					const [x, py] = proj(c);
					if(i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
				});
				ctx.stroke();

				const [sx, sy] = proj(entry.routeCoords[0]);
				const [ex, ey] = proj(entry.routeCoords[entry.routeCoords.length - 1]);
				ctx.fillStyle = '#f4c430';
				ctx.beginPath();
				ctx.arc(sx, sy, 11, 0, Math.PI*2);
				ctx.fill();
				ctx.fillStyle = '#ecedef';
				ctx.beginPath();
				ctx.arc(ex, ey, 11, 0, Math.PI*2);
				ctx.fill();

				ctx.fillStyle = '#ecedef';
				ctx.font = '500 30px "Space Grotesk", sans-serif';
				let routeLabel = `${entry.routeFrom} → ${entry.routeTo}`;
				if(routeLabel.length > 44) routeLabel = routeLabel.slice(0, 42) + '…';
				ctx.fillText(routeLabel, 70, boxY + boxH + 50);
				ctx.fillStyle = '#7c848c';
				ctx.font = '500 24px "JetBrains Mono", monospace';
				ctx.fillText(`${entry.routeTotalKm.toFixed(1)} km route`, 70, boxY + boxH + 84);
			}

			// Recap the interesting places surfaced during the ride (text only, so the
			// canvas stays untainted and exportable). Facts only exist on routed rides.
			if(entry.facts && entry.facts.length) {
				const hasRoute = entry.routeCoords && entry.routeCoords.length > 1;
				let fy = hasRoute ? 1560 : 900;
				ctx.fillStyle = '#7c848c';
				ctx.font = '600 26px "Space Grotesk", sans-serif';
				ctx.fillText('DISCOVERED ALONG THE WAY', 70, fy);
				fy += 46;

				const fit = (str, maxW) => {
					if(ctx.measureText(str).width <= maxW) return str;
					while(str.length > 1 && ctx.measureText(str + '…').width > maxW) str = str.slice(0, -1);
					return str + '…';
				};
				const maxFacts = 4;
				ctx.font = '500 30px "Space Grotesk", sans-serif';
				entry.facts.slice(0, maxFacts).forEach(f => {
					ctx.fillStyle = '#ecedef';
					ctx.fillText(fit('💡 ' + (f.title || ''), W - 140), 70, fy);
					fy += 46;
				});
				if(entry.facts.length > maxFacts) {
					ctx.fillStyle = '#7c848c';
					ctx.font = '500 24px "JetBrains Mono", monospace';
					ctx.fillText(`+${entry.facts.length - maxFacts} more`, 70, fy + 2);
				}
			}

			ctx.fillStyle = '#4a5158';
			ctx.font = '500 24px "JetBrains Mono", monospace';
			ctx.fillText('Ride Summary', 70, H - 60);

			return canvas;
		}

		async function shareRide(entry, triggerBtn) {
			const originalLabel = triggerBtn ? triggerBtn.textContent : null;
			if(triggerBtn) {
				triggerBtn.textContent = '…';
				triggerBtn.disabled = true;
			}
			try {
				const canvas = await buildShareCanvas(entry);
				const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
				if(!blob) throw new Error('Could not render image');
				const file = new File([blob], `ride-${entry.ts}.png`, {type: 'image/png'});

				if(navigator.canShare && navigator.canShare({files: [file]})) {
					await navigator.share({
						files: [file],
						title: 'My ride',
						text: `${(entry.routeCoveredKm ?? entry.distanceKm).toFixed(1)} km ride — ${entry.avgPower}W avg`
					});
				} else {
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = `ride-${entry.ts}.png`;
					document.body.appendChild(a);
					a.click();
					a.remove();
					setTimeout(() => URL.revokeObjectURL(url), 5000);
					alert('Image saved — open Instagram and add it to your story from there.');
				}
			} catch(err) {
				if(err.name !== 'AbortError') {
					console.error(err);
					alert('Could not create the share image: ' + err.message);
				}
			} finally {
				if(triggerBtn) {
					triggerBtn.textContent = originalLabel;
					triggerBtn.disabled = false;
				}
			}
		}
