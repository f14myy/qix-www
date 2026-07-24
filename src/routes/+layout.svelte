<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import CallOverlay from '$lib/components/CallOverlay.svelte';
	import AppFlash from '$lib/components/AppFlash.svelte';
	import RecoveryCodesGate from '$lib/components/RecoveryCodesGate.svelte';
	import {
		handleIncomingInvite,
		onCallAccepted,
		onCallEnded,
		onCallRejected,
		onCallSignal,
		resumeActiveCall
	} from '$lib/calls/store.svelte';
	import { initTheme, statusBarColor } from '$lib/theme';
	import { initLocale } from '$lib/i18n';
	import { fetchSettings } from '$lib/settings';
	import { registerServiceWorker } from '$lib/pwa';
	import { bootstrapE2ee } from '$lib/e2ee/bootstrap';
	import '../app.css';

	let { children } = $props();
	let themeColor = $state('#1a7a6d');

	onMount(() => {
		initLocale();
		initTheme();
		themeColor = statusBarColor();
		const onTheme = () => {
			themeColor = statusBarColor();
		};
		window.addEventListener('qix-theme', onTheme);
		registerServiceWorker();
		fetchSettings().catch(() => {
			/* guest / offline */
		});
		if (page.data.user) {
			void bootstrapE2ee(page.data.user.id).catch(() => {
				/* crypto unavailable */
			});
		}

		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			initTheme();
			themeColor = statusBarColor();
		};
		mq.addEventListener('change', onChange);

		let es: EventSource | null = null;
		let beat: ReturnType<typeof setInterval> | undefined;

		function connectCalls() {
			if (!page.data.user) return;
			es?.close();
			es = new EventSource('/api/events');
			es.addEventListener('call_invite', (ev) => {
				try {
					const d = JSON.parse(ev.data) as {
						callId: string;
						chatId: string;
						video: boolean;
						from: {
							id: string;
							username: string;
							displayName: string | null;
							avatarPath: string | null;
						};
					};
					void handleIncomingInvite(d);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('call_accepted', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { callId: string };
					void onCallAccepted(d.callId);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('call_rejected', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { callId: string };
					onCallRejected(d.callId);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('call_ended', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { callId: string };
					onCallEnded(d.callId);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('call_signal', (ev) => {
				try {
					const d = JSON.parse(ev.data) as {
						callId: string;
						fromUserId: string;
						type: 'offer' | 'answer' | 'ice';
						sdp: RTCSessionDescriptionInit | null;
						candidate: RTCIceCandidateInit | null;
					};
					void onCallSignal(d);
				} catch {
					/* ignore */
				}
			});
			beat = setInterval(() => fetch('/api/presence', { method: 'POST' }), 30000);
		}

		function disconnectCalls() {
			es?.close();
			es = null;
			if (beat) {
				clearInterval(beat);
				beat = undefined;
			}
		}

		const onVisibility = () => {
			if (document.hidden) disconnectCalls();
			else {
				connectCalls();
				void resumeActiveCall();
			}
		};

		if (page.data.user) {
			connectCalls();
			void resumeActiveCall();
		}
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			mq.removeEventListener('change', onChange);
			window.removeEventListener('qix-theme', onTheme);
			document.removeEventListener('visibilitychange', onVisibility);
			disconnectCalls();
		};
	});
</script>

<svelte:head>
	<title>Qix</title>
	<meta name="description" content="Light messenger for your privacy" />
	<meta name="theme-color" content={themeColor} />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Qix" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
</svelte:head>

<div class="app-shell">
	{@render children()}
</div>

<AppFlash />

{#if page.data.user}
	<RecoveryCodesGate />
	<CallOverlay />
{/if}
