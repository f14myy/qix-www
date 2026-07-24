/* Minimal service worker — enables installability; caches shell assets. */
const CACHE = 'qix-shell-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon.svg'];

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
				if (response.ok && (url.pathname === '/' || url.pathname.match(/\.(css|js|svg|woff2?)$/))) {
					caches.open(CACHE).then((cache) => cache.put(request, copy));
				}
				return response;
			})
			.catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
	);
});
