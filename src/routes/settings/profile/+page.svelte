<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import type { PublicProfile } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();

	let displayName = $state('');
	let bio = $state('');
	let avatarPath = $state<string | null>(null);
	let avatarFile = $state<File | null>(null);
	let previewUrl = $state<string | null>(null);
	let status = $state('');
	let saving = $state(false);

	onMount(async () => {
		const res = await fetch('/api/me/profile');
		const json = await res.json();
		const p = json.profile as PublicProfile;
		displayName = p.displayName ?? '';
		bio = p.bio ?? '';
		avatarPath = p.avatarPath;
	});

	function onAvatar(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		avatarFile = f;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = f ? URL.createObjectURL(f) : null;
	}

	async function save(e: Event) {
		e.preventDefault();
		saving = true;
		status = '';
		try {
			const form = new FormData();
			form.set('displayName', displayName);
			form.set('bio', bio);
			if (avatarFile) form.set('avatar', avatarFile);
			const res = await fetch('/api/me/profile', { method: 'PATCH', body: form });
			const json = await res.json();
			if (!res.ok) {
				status = json.error || 'Error';
				return;
			}
			avatarPath = json.profile.avatarPath;
			avatarFile = null;
			status = i18n.t('profile.saved');
		} finally {
			saving = false;
		}
	}
</script>

<div class="screen">
	<header class="topbar">
		<button
			type="button"
			class="icon-btn"
			aria-label={i18n.t('back')}
			onclick={() => goto('/settings')}
		>
			<ArrowLeft size={22} />
		</button>
		<h1>{i18n.t('profile.title')}</h1>
	</header>

	<form class="settings-body" onsubmit={save}>
		<section class="settings-section" style="display:flex;flex-direction:column;align-items:center;gap:12px">
			{#if previewUrl}
				<img class="avatar" src={previewUrl} alt="" style="width:88px;height:88px;object-fit:cover" />
			{:else}
				<Avatar
					name={displayName || data.user?.username || '?'}
					size={88}
					{avatarPath}
					userId={data.user?.id}
				/>
			{/if}
			<label class="btn btn-ghost" style="cursor:pointer">
				{i18n.t('profile.avatar')}
				<input type="file" accept="image/*" hidden onchange={onAvatar} />
			</label>
		</section>

		<section class="settings-section">
			<div class="field">
				<label for="displayName">{i18n.t('profile.displayName')}</label>
				<input id="displayName" maxlength="40" bind:value={displayName} />
			</div>
			<div class="field" style="margin-top:12px">
				<label for="bio">{i18n.t('profile.bio')}</label>
				<input id="bio" maxlength="160" bind:value={bio} />
			</div>
		</section>

		{#if status}
			<p style="padding:0 16px;color:var(--accent)">{status}</p>
		{/if}

		<section class="settings-section">
			<button class="btn btn-block" type="submit" disabled={saving}>
				{saving ? i18n.t('profile.saving') : i18n.t('profile.save')}
			</button>
		</section>
	</form>
</div>
