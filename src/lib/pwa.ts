import { subscribeWebPush } from './notify';

/** Register the lightweight service worker when running as an installable PWA. */
export function registerServiceWorker() {
	if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
	window.addEventListener('load', () => {
		navigator.serviceWorker
			.register('/sw.js')
			.then(() => {
				if (Notification.permission === 'granted') {
					subscribeWebPush().catch(() => {});
				}
			})
			.catch(() => {
				/* ignore — install still works on iOS without SW */
			});
	});
}

export function isStandaloneDisplay(): boolean {
	if (typeof window === 'undefined') return false;
	const mq = window.matchMedia('(display-mode: standalone)').matches;
	const ios = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone;
	return mq || !!ios;
}

const TIP_KEY = 'qix-install-tip-dismissed';

export function shouldShowInstallTip(): boolean {
	if (typeof window === 'undefined') return false;
	if (isStandaloneDisplay()) return false;
	try {
		return localStorage.getItem(TIP_KEY) !== '1';
	} catch {
		return false;
	}
}

export function dismissInstallTip() {
	try {
		localStorage.setItem(TIP_KEY, '1');
	} catch {
		/* ignore */
	}
}
