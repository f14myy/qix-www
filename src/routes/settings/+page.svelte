<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { getStoredTheme, setThemePreference, type ThemePreference } from '$lib/theme';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import type { Locale } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let theme = $state<ThemePreference>('system');

	onMount(() => {
		theme = getStoredTheme();
	});

	function setTheme(next: ThemePreference) {
		theme = next;
		setThemePreference(next);
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		await goto('/login');
	}
</script>

<div class="screen">
	<header class="topbar">
		<button type="button" class="icon-btn" aria-label={i18n.t('back')} onclick={() => goto('/')}>
			<ArrowLeft size={22} />
		</button>
		<h1>{i18n.t('settings.title')}</h1>
	</header>

	<div class="settings-body">
		<section class="settings-section">
			<h2>{i18n.t('settings.account')}</h2>
			<div class="settings-card">
				<div class="settings-row">
					<span class="label">{i18n.t('settings.username')}</span>
					<span class="value">@{data.user?.username}</span>
				</div>
				<a class="settings-row link-row" href="/settings/profile">
					<span class="label">{i18n.t('settings.profile')}</span>
					<span class="value">→</span>
				</a>
			</div>
		</section>

		<section class="settings-section">
			<h2>{i18n.t('settings.appearance')}</h2>
			<div class="settings-card">
				<div class="settings-row" style="flex-direction:column;align-items:stretch;gap:10px">
					<span class="label">{i18n.t('settings.theme')}</span>
					<div class="theme-pills">
						<button
							type="button"
							class="theme-pill"
							class:active={theme === 'system'}
							onclick={() => setTheme('system')}>{i18n.t('settings.system')}</button
						>
						<button
							type="button"
							class="theme-pill"
							class:active={theme === 'light'}
							onclick={() => setTheme('light')}>{i18n.t('settings.light')}</button
						>
						<button
							type="button"
							class="theme-pill"
							class:active={theme === 'dark'}
							onclick={() => setTheme('dark')}>{i18n.t('settings.dark')}</button
						>
					</div>
				</div>
				<div class="settings-row" style="flex-direction:column;align-items:stretch;gap:10px">
					<span class="label">{i18n.t('settings.language')}</span>
					<div class="theme-pills">
						<button
							type="button"
							class="theme-pill"
							class:active={i18n.locale === 'en'}
							onclick={() => i18n.setLocale('en' as Locale)}>English</button
						>
						<button
							type="button"
							class="theme-pill"
							class:active={i18n.locale === 'ru'}
							onclick={() => i18n.setLocale('ru' as Locale)}>Русский</button
						>
					</div>
				</div>
			</div>
		</section>

		<section class="settings-section">
			<button class="btn btn-block" type="button" onclick={logout}>{i18n.t('settings.logout')}</button>
		</section>
	</div>
</div>
