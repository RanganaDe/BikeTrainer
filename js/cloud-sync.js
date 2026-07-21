		// ---------- cloud sync (Firebase Auth + Firestore) ----------
		// Paste the config object from Firebase console → Project settings → Your apps.
		// Until this is filled in, the app runs local-only (exactly as before) and the
		// sign-in button is disabled — nothing breaks if you haven't set this up yet.
		const firebaseConfig = {
			apiKey: "AIzaSyC4TRY0G1qGNfinW8gkyMLvAhffgenBAWk",
			authDomain: "cadence-log.firebaseapp.com",
			projectId: "cadence-log",
			storageBucket: "cadence-log.firebasestorage.app",
			messagingSenderId: "1085737653871",
			appId: "1:1085737653871:web:9bbffa0b2a4e67409b5f9a"
		};
		// const cloudConfigured = firebaseConfig.apiKey !== "AIzaSyC4TRY0G1qGNfinW8gkyMLvAhffgenBAWk";
		const cloudConfigured = true;

		let fbAuth = null, fbDb = null, currentUser = null;

		if(cloudConfigured && window.firebase) {
			try {
				firebase.initializeApp(firebaseConfig);
				fbAuth = firebase.auth();
				fbDb = firebase.firestore();
			} catch(e) {
				console.error('Firebase init failed:', e);
			}
		}

		function setAccountUI(user) {
			if(user) {
				els.accountName.textContent = user.displayName || user.email || 'Signed in';
				els.accountName.classList.add('signed-in');
				if(user.photoURL) {
					els.accountAvatar.style.backgroundImage = `url(${user.photoURL})`;
					els.accountAvatar.classList.add('has-photo');
				}
				els.authBtn.textContent = 'Sign out';
				els.authBtn.classList.add('signed-in');
			} else {
				els.accountName.textContent = cloudConfigured ? 'Not signed in' : 'Cloud sync not set up';
				els.accountName.classList.remove('signed-in');
				els.accountAvatar.style.backgroundImage = '';
				els.accountAvatar.classList.remove('has-photo');
				els.authBtn.textContent = 'Sign in with Google';
				els.authBtn.classList.remove('signed-in');
			}
		}

		setAccountUI(null);
		if(!cloudConfigured) {
			els.authBtn.disabled = true;
			els.authBtn.title = 'Add your Firebase config in the code to enable cloud sync';
		}

		function ridesCollection(uid) {
			return fbDb.collection('users').doc(uid).collection('rides');
		}

		async function pushRideToCloud(entry) {
			if(!fbDb || !currentUser) return;
			try {
				await ridesCollection(currentUser.uid).doc(String(entry.ts)).set(entry);
			} catch(e) {
				console.error('Could not save ride to cloud:', e);
			}
		}

		async function syncFromCloud() {
			if(!fbDb || !currentUser) return;
			els.accountName.textContent = 'Syncing…';
			try {
				const snap = await ridesCollection(currentUser.uid).get();
				const cloudRides = snap.docs.map(d => d.data());
				const local = loadHistory();
				const byTs = new Map(local.map(r => [r.ts, r]));

				// Bring down anything the cloud has that we don't have locally yet.
				cloudRides.forEach(r => {
					if(!byTs.has(r.ts)) byTs.set(r.ts, r);
				});

				// Push up anything we have locally that the cloud doesn't have yet
				// (e.g. rides logged before you signed in).
				const cloudTsSet = new Set(cloudRides.map(r => r.ts));
				const toUpload = local.filter(r => !cloudTsSet.has(r.ts));
				await Promise.all(toUpload.map(r => pushRideToCloud(r)));

				const merged = Array.from(byTs.values());
				saveHistory(merged);
				renderHistory();
			} catch(e) {
				console.error('Cloud sync failed:', e);
			} finally {
				setAccountUI(currentUser);
			}
		}

		if(fbAuth) {
			fbAuth.onAuthStateChanged(user => {
				currentUser = user;
				setAccountUI(user);
				if(user) syncFromCloud();
			});
		}

		els.authBtn.addEventListener('click', async () => {
			if(!cloudConfigured) return;
			if(currentUser) {
				await fbAuth.signOut();
				return;
			}
			try {
				const provider = new firebase.auth.GoogleAuthProvider();
				await fbAuth.signInWithPopup(provider);
			} catch(e) {
				console.error('Sign-in failed:', e);
				alert('Sign-in failed: ' + e.message);
			}
		});
