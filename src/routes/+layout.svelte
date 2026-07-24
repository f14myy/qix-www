<script lang="ts">
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme';
	import { initLocale } from '$lib/i18n';
	import { registerServiceWorker } from '$lib/pwa';
	import '../app.css';

	let { children } = $props();
	let themeColor = $state('#1a7a6d');

	onMount(() => {
		initLocale();
		const resolved = initTheme();
		themeColor = resolved === 'dark' ? '#0c1116' : '#1a7a6d';
		registerServiceWorker();

		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			const next = initTheme();
			themeColor = next === 'dark' ? '#0c1116' : '#1a7a6d';
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
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
	<link rel="apple-touch-icon" href="/icons/icon.svg" />
</svelte:head>

<div class="app-shell">
	{@render children()}
</div>
