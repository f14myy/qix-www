<script lang="ts">
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme';
	import { initLocale } from '$lib/i18n';
	import '../app.css';

	let { children } = $props();
	let themeColor = $state('#1a7a6d');

	onMount(() => {
		initLocale();
		const resolved = initTheme();
		themeColor = resolved === 'dark' ? '#0c1116' : '#1a7a6d';

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
	<meta name="theme-color" content={themeColor} />
	<meta name="apple-mobile-web-app-capable" content="yes" />
</svelte:head>

<div class="app-shell">
	{@render children()}
</div>
