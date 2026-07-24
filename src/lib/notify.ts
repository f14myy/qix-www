import { getCachedSettings } from './settings';

export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
	if (Notification.permission === 'granted' || Notification.permission === 'denied') {
		return Notification.permission;
	}
	return Notification.requestPermission();
}

function urlBase64ToUint8Array(base64String: string) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** Subscribe to Web Push and register the endpoint with the server. */
export async function subscribeWebPush(): Promise<boolean> {
	if (typeof window === 'undefined') return false;
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
	if (Notification.permission !== 'granted') return false;

	try {
		const keyRes = await fetch('/api/push/vapid-key');
		if (!keyRes.ok) return false;
		const { publicKey } = (await keyRes.json()) as { publicKey: string };
		if (!publicKey) return false;

		const reg = await navigator.serviceWorker.ready;
		let sub = await reg.pushManager.getSubscription();
		if (!sub) {
			sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey)
			});
		}

		const json = sub.toJSON();
		if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

		const res = await fetch('/api/push/subscribe', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				endpoint: json.endpoint,
				keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }
			})
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function unsubscribeWebPush(): Promise<void> {
	if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
	try {
		const reg = await navigator.serviceWorker.ready;
		const sub = await reg.pushManager.getSubscription();
		if (!sub) return;
		await fetch('/api/push/subscribe', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: sub.endpoint })
		});
		await sub.unsubscribe();
	} catch {
		/* ignore */
	}
}

export function notifyMessage(opts: { title: string; body: string; tag?: string; href?: string }) {
	const s = getCachedSettings();
	if (!s.notifyMessages) return;
	if (typeof document !== 'undefined' && !document.hidden) return;
	if (typeof window === 'undefined' || !('Notification' in window)) return;
	if (Notification.permission !== 'granted') return;

	try {
		if (s.notifySound) playNotifySound();
		const n = new Notification(opts.title, {
			body: opts.body,
			tag: opts.tag ?? 'qix-message',
			icon: '/icons/icon-192.png'
		});
		n.onclick = () => {
			window.focus();
			if (opts.href) window.location.href = opts.href;
			n.close();
		};
	} catch {
		/* ignore */
	}
}

function playNotifySound() {
	try {
		const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		if (!Ctx) return;
		const ctx = new Ctx();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.value = 880;
		gain.gain.value = 0.04;
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start();
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
		osc.stop(ctx.currentTime + 0.2);
		osc.onended = () => ctx.close().catch(() => {});
	} catch {
		/* ignore */
	}
}
