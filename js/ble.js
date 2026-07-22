		// ---------- FTMS indoor bike data (0x2AD2) ----------
		function handleIndoorBikeData(event) {
			const dv = event.target.value;
			let offset = 0;
			const flags = dv.getUint16(offset, true);
			offset += 2;
			const moreData = flags & 0x1;
			const avgSpeedP = flags & 0x2;
			const instCadP = flags & 0x4;
			const avgCadP = flags & 0x8;
			const totalDistP = flags & 0x10;
			const resistP = flags & 0x20;
			const instPowerP = flags & 0x40;
			const avgPowerP = flags & 0x80;
			const expEnergyP = flags & 0x100;
			const hrP = flags & 0x200;
			const metP = flags & 0x400;
			const elapsedP = flags & 0x800;
			const remainP = flags & 0x1000;

			const parts = [`flags=0x${flags.toString(16).padStart(4, '0')}`];

			if(!moreData) {
				const speed = dv.getUint16(offset, true)*0.01;
				offset += 2;
				updateSpeed(speed);
				parts.push(`speed=<b>${speed.toFixed(2)} km/h</b>`);
			} else {
				parts.push('speed n/a this packet');
			}
			if(avgSpeedP) {
				const avgSpeed = dv.getUint16(offset, true)*0.01;
				offset += 2;
				parts.push(`avgSpeed=${avgSpeed.toFixed(2)} km/h`);
			}
			if(instCadP) {
				const cadence = dv.getUint16(offset, true)*0.5;
				offset += 2;
				updateCadence(cadence);
				parts.push(`cadence=<b>${cadence} rpm</b>`);
			}
			if(avgCadP) {
				const avgCadence = dv.getUint16(offset, true)*0.5;
				offset += 2;
				parts.push(`avgCadence=${avgCadence} rpm`);
			}
			if(totalDistP) {
				const distanceM = dv.getUint8(offset) | (dv.getUint8(offset + 1)<<8) | (dv.getUint8(offset + 2)<<16);
				offset += 3;
				updateBikeDistance(distanceM);
				parts.push(`distance=<b>${(distanceM/1000).toFixed(2)} km</b>`);
			}
			if(resistP) {
				const resistance = dv.getInt16(offset, true);
				offset += 2;
				updateResistance(resistance);
				parts.push(`resistance=${resistance}`);
			}
			if(instPowerP) {
				const power = dv.getInt16(offset, true);
				offset += 2;
				updatePower(power);
				parts.push(`power=<b>${power} W</b>`);
			} else {
				parts.push('power n/a this packet');
			}
			if(avgPowerP) {
				const avgPower = dv.getInt16(offset, true);
				offset += 2;
				parts.push(`avgPower=${avgPower} W`);
			}
			if(expEnergyP) {
				const totalEnergy = dv.getUint16(offset, true);
				offset += 2;
				const energyPerHour = dv.getUint16(offset, true);
				offset += 2;
				let energyPerMin = null;
				if(offset < dv.byteLength) {
					energyPerMin = dv.getUint8(offset);
					offset += 1;
				}
				updateCalories(totalEnergy);
				parts.push(`calories=<b>${totalEnergy} kcal</b> (${energyPerHour}/hr)`);
			}
			if(hrP && offset < dv.byteLength) {
				const hr = dv.getUint8(offset);
				offset += 1;
				parts.push(`heartRate=${hr} bpm`);
			}
			if(metP && offset < dv.byteLength) {
				const met = dv.getUint8(offset);
				offset += 1;
				parts.push(`met=${met}`);
			}
			if(elapsedP && offset + 1 < dv.byteLength) {
				const elapsed = dv.getUint16(offset, true);
				offset += 2;
				updateBikeElapsed(elapsed);
				parts.push(`bikeElapsed=<b>${fmtDuration(elapsed)}</b>`);
			}
			if(remainP && offset + 1 < dv.byteLength) {
				const remaining = dv.getUint16(offset, true);
				offset += 2;
				parts.push(`remaining=${fmtDuration(remaining)}`);
			}
			logPacket('indoor_bike_data', dv, parts.join(' · '));
		}

		// ---------- Cycling Power Measurement (0x2A63) ----------
		function handlePowerMeasurement(event) {
			const dv = event.target.value;
			const flags = dv.getUint16(0, true);
			const power = dv.getInt16(2, true); // instantaneous power always follows the 2-byte flags field
			updatePower(power);
			logPacket('cycling_power_measurement', dv,
				`flags=0x${flags.toString(16).padStart(4, '0')} · power=<b>${power} W</b>` +
				(dv.byteLength > 4 ? ` · +${dv.byteLength - 4} extra bytes (torque/wheel/crank data, unused)` : ''));
		}

		// ---------- CSC Measurement (0x2A5B) for speed fallback ----------
		function handleCSCMeasurement(event) {
			const dv = event.target.value;
			let offset = 0;
			const flags = dv.getUint8(offset);
			offset += 1;
			const wheelPresent = flags & 0x1;
			const crankPresent = flags & 0x2;
			if(!wheelPresent) {
				logPacket('csc_measurement', dv, `flags=0x${flags.toString(16).padStart(2, '0')} · no wheel revolution data in this packet`);
				return;
			}

			const cumRevs = dv.getUint32(offset, true);
			offset += 4;
			const eventTime = dv.getUint16(offset, true);
			offset += 2; // units of 1/1024s

			let summary = `flags=0x${flags.toString(16).padStart(2, '0')} · wheelRevs=${cumRevs} · eventTime=${eventTime}`;
			if(crankPresent) summary += ' · crank data present (unused)';

			if(prevWheelRevs !== null) {
				let deltaRevs = cumRevs - prevWheelRevs;
				if(deltaRevs < 0) deltaRevs += 0x100000000;
				let deltaTime = eventTime - prevWheelEventTime;
				if(deltaTime < 0) deltaTime += 0x10000;
				if(deltaTime > 0) {
					const deltaTimeS = deltaTime/1024;
					const circM = (parseFloat(els.wheelCirc.value) || 2105)/1000;
					const distM = deltaRevs*circM;
					const speed = (distM/deltaTimeS)*3.6;
					updateSpeed(speed);
					summary += ` · speed=<b>${speed.toFixed(2)} km/h</b>`;
				} else {
					summary += ' · no new wheel event (coasting/stopped)';
				}
			} else {
				summary += ' · first reading, no delta yet';
			}
			prevWheelRevs = cumRevs;
			prevWheelEventTime = eventTime;
			logPacket('csc_measurement', dv, summary);
		}

		// ---------- connection ----------
		function onDisconnected() {
			setStatus('disconnected', 'disconnected');
			els.connectBtn.textContent = 'Connect sensor';
			els.rideBtn.disabled = true;
			if(isRiding) stopRide();
		}

		// Bluefy (and some other non-Chrome Web Bluetooth implementations) don't resolve the
		// human-readable short names Chrome accepts (e.g. 'fitness_machine'). Explicit
		// Bluetooth SIG UUIDs work identically everywhere, so we use those instead.
		const BLE_SERVICE_UUID = {
			fitnessMachine: '00001826-0000-1000-8000-00805f9b34fb',
			indoorBikeData: '00002ad2-0000-1000-8000-00805f9b34fb',
			cyclingPower: '00001818-0000-1000-8000-00805f9b34fb',
			cyclingPowerMeasurement: '00002a63-0000-1000-8000-00805f9b34fb',
			cyclingSpeedCadence: '00001816-0000-1000-8000-00805f9b34fb',
			cscMeasurement: '00002a5b-0000-1000-8000-00805f9b34fb',
			deviceInformation: '0000180a-0000-1000-8000-00805f9b34fb',
		};

		async function connect() {
			try {
				setStatus('connecting', 'connecting…');
				device = await navigator.bluetooth.requestDevice({
					filters: [
						{services: [BLE_SERVICE_UUID.fitnessMachine]},
						{services: [BLE_SERVICE_UUID.cyclingPower]},
						{services: [BLE_SERVICE_UUID.cyclingSpeedCadence]},
					],
					optionalServices: [BLE_SERVICE_UUID.fitnessMachine, BLE_SERVICE_UUID.cyclingPower, BLE_SERVICE_UUID.cyclingSpeedCadence, BLE_SERVICE_UUID.deviceInformation]
				});
				device.addEventListener('gattserverdisconnected', onDisconnected);
				logEvent('connect', `device picked: <b>${escapeHtml(device.name || '(unnamed)')}</b>, id=${escapeHtml(device.id)}`);
				server = await device.gatt.connect();

				const allServices = await server.getPrimaryServices();
				logEvent('connect', `advertised services: ${allServices.map(s => s.uuid).join(', ') || 'none found'}`);

				usingFTMS = false;
				try {
					const ftms = await server.getPrimaryService(BLE_SERVICE_UUID.fitnessMachine);
					const indoorBike = await ftms.getCharacteristic(BLE_SERVICE_UUID.indoorBikeData);
					await indoorBike.startNotifications();
					indoorBike.addEventListener('characteristicvaluechanged', handleIndoorBikeData);
					usingFTMS = true;
					logEvent('connect', 'using <b>fitness_machine</b> service — indoor_bike_data notifications started');
				} catch(e) {
					logEvent('connect', 'no fitness_machine (FTMS) service found');
				}

				if(!usingFTMS) {
					let gotPower = false, gotSpeed = false;
					try {
						const cps = await server.getPrimaryService(BLE_SERVICE_UUID.cyclingPower);
						const powerChar = await cps.getCharacteristic(BLE_SERVICE_UUID.cyclingPowerMeasurement);
						await powerChar.startNotifications();
						powerChar.addEventListener('characteristicvaluechanged', handlePowerMeasurement);
						gotPower = true;
						logEvent('connect', 'using <b>cycling_power</b> service — power notifications started');
					} catch(e) {
						logEvent('connect', 'no cycling_power service found');
					}
					try {
						const csc = await server.getPrimaryService(BLE_SERVICE_UUID.cyclingSpeedCadence);
						const cscChar = await csc.getCharacteristic(BLE_SERVICE_UUID.cscMeasurement);
						await cscChar.startNotifications();
						cscChar.addEventListener('characteristicvaluechanged', handleCSCMeasurement);
						gotSpeed = true;
						logEvent('connect', 'using <b>cycling_speed_and_cadence</b> service — CSC notifications started');
					} catch(e) {
						logEvent('connect', 'no cycling_speed_and_cadence service found');
					}

					if(!gotPower && !gotSpeed) {
						throw new Error('No supported cycling services found on this device.');
					}
				}

				setStatus('connected', device.name || 'connected');
				els.connectBtn.textContent = 'Disconnect';
				els.rideBtn.disabled = false;
			} catch(err) {
				console.error(err);
				setStatus('disconnected', 'disconnected');
				els.connectBtn.textContent = 'Connect sensor';
				if(err.name !== 'NotFoundError') {
					alert('Couldn\'t connect: ' + err.message);
				}
			}
		}

		els.connectBtn.addEventListener('click', () => {
			if(device && device.gatt.connected) {
				device.gatt.disconnect();
			} else {
				connect();
			}
		});
