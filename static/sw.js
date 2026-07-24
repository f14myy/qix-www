/* Service worker — shell cache + Web Push notifications. */
const CACHE = 'qix-shell-v2';
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith('/api/')) return;

	event.respondWith(
		fetch(request)
			.then((response) => {
				const copy = response.clone();
				if (response.ok && (url.pathname === '/' || url.pathname.match(/\.(css|js|svg|png|woff2?)$/))) {
					caches.open(CACHE).then((cache) => cache.put(request, copy));
				}
				return response;
			})
			.catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
	);
});

self.addEventListener('push', (event) => {
	let data = { title: 'Qix', body: '', href: '/', tag: 'qix-message' };
	try {
		if (event.data) data = { ...data, ...event.data.json() };
	} catch {
		try {
			const text = event.data?.text();
			if (text) data.body = text;
		} catch {
			/* ignore */
		}
	}

	event.waitUntil(
		self.registration.showNotification(data.title || 'Qix', {
			body: data.body || '',
			tag: data.tag || 'qix-message',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			data: { href: data.href || '/' }
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const href = event.notification.data?.href || '/';
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
			for (const client of clientList) {
				if ('focus' in client) {
					client.navigate?.(href);
					return client.focus();
				}
			}
			if (self.clients.openWindow) return self.clients.openWindow(href);
		})
	);
});
