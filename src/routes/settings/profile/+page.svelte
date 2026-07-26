<script lang="ts">
	import { untrack } from 'svelte';
	import Camera from '@lucide/svelte/icons/camera';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Eye from '@lucide/svelte/icons/eye';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { goBack } from '$lib/nav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();

	const NAME_MAX = 40;
	const BIO_MAX = 160;

	const seed = untrack(() => data.profile);
	let displayName = $state(seed.displayName ?? '');
	let bio = $state(seed.bio ?? '');
	let avatarPath = $state(seed.avatarPath);
	let bannerPath = $state(seed.bannerPath);
	let baselineName = $state(seed.displayName ?? '');
	let baselineBio = $state(seed.bio ?? '');
	let avatarFile = $state<File | null>(null);
	let bannerFile = $state<File | null>(null);
	let removeAvatar = $state(false);
	let removeBanner = $state(false);
	let previewUrl = $state<string | null>(null);
	let bannerPreviewUrl = $state<string | null>(null);
	let status = $state('');
	let error = $state('');
	let saving = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let bannerInput = $state<HTMLInputElement | null>(null);

	const dirty = $derived(
		displayName.trim() !== baselineName.trim() ||
			bio.trim() !== baselineBio.trim() ||
			!!avatarFile ||
			!!bannerFile ||
			removeAvatar ||
			removeBanner
	);

	const showPhoto = $derived(!!previewUrl || (!removeAvatar && !!avatarPath));
	const showBanner = $derived(!!bannerPreviewUrl || (!removeBanner && !!bannerPath));
	const bannerSrc = $derived(
		bannerPreviewUrl ||
			(showBanner && bannerPath ? `/api/banners/${data.profile.id}?v=${bannerPath}` : null)
	);

	function onAvatar(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		if (!f) return;
		if (f.size > 5 * 1024 * 1024) {
			error = i18n.t('profile.avatarTooLarge');
			return;
		}
		if (!f.type.startsWith('image/')) {
			error = i18n.t('profile.avatarType');
			return;
		}
		error = '';
		status = '';
		avatarFile = f;
		removeAvatar = false;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(f);
	}

	function onBanner(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		if (!f) return;
		if (f.size > 8 * 1024 * 1024) {
			error = i18n.t('profile.bannerTooLarge');
			return;
		}
		if (!f.type.startsWith('image/')) {
			error = i18n.t('profile.bannerType');
			return;
		}
		error = '';
		status = '';
		bannerFile = f;
		removeBanner = false;
		if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
		bannerPreviewUrl = URL.createObjectURL(f);
	}

	function clearAvatar() {
		avatarFile = null;
		removeAvatar = !!avatarPath;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		if (fileInput) fileInput.value = '';
	}

	function clearBanner() {
		bannerFile = null;
		removeBanner = !!bannerPath;
		if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
		bannerPreviewUrl = null;
		if (bannerInput) bannerInput.value = '';
	}

	async function save(e: Event) {
		e.preventDefault();
		if (!dirty || saving) return;
		saving = true;
		status = '';
		error = '';
		try {
			const form = new FormData();
			form.set('displayName', displayName.trim());
			form.set('bio', bio.trim());
			if (avatarFile) form.set('avatar', avatarFile);
			if (removeAvatar) form.set('removeAvatar', '1');
			if (bannerFile) form.set('banner', bannerFile);
			if (removeBanner) form.set('removeBanner', '1');
			const res = await fetch('/api/me/profile', { method: 'PATCH', body: form });
			const text = await res.text();
			let json: {
				error?: string;
				profile?: {
					displayName: string | null;
					bio: string | null;
					avatarPath: string | null;
					bannerPath: string | null;
				};
			} = {};
			try {
				json = text ? JSON.parse(text) : {};
			} catch {
				error = text.slice(0, 160) || i18n.t('profile.error');
				return;
			}
			if (!res.ok) {
				error = json.error || i18n.t('profile.error');
				return;
			}
			const p = json.profile;
			if (!p) {
				error = i18n.t('profile.error');
				return;
			}
			displayName = p.displayName ?? '';
			bio = p.bio ?? '';
			avatarPath = p.avatarPath;
			bannerPath = p.bannerPath;
			baselineName = displayName;
			baselineBio = bio;
			avatarFile = null;
			bannerFile = null;
			removeAvatar = false;
			removeBanner = false;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = null;
			if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
			bannerPreviewUrl = null;
			if (fileInput) fileInput.value = '';
			if (bannerInput) bannerInput.value = '';
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
			onclick={() => goBack('/settings')}
		>
			<ArrowLeft size={22} />
		</button>
		<h1>{i18n.t('profile.editTitle')}</h1>
		<a class="icon-btn" href="/u/{data.profile.username}" aria-label={i18n.t('profile.viewPublic')}>
			<Eye size={20} />
		</a>
	</header>

	<form class="settings-body profile-edit" onsubmit={save}>
		<section class="profile-edit-cover">
			<button
				type="button"
				class="profile-banner profile-banner-edit"
				data-banner={data.profile.bannerKey}
				aria-label={i18n.t('profile.changeBanner')}
				onclick={() => bannerInput?.click()}
			>
				{#if bannerSrc}
					<img class="profile-banner-img" src={bannerSrc} alt="" />
				{/if}
				<span class="profile-banner-cam">
					<Camera size={18} />
				</span>
			</button>
			<input bind:this={bannerInput} type="file" accept="image/*" hidden onchange={onBanner} />

			<div class="profile-avatar-edit profile-avatar-edit-overlap">
				{#if previewUrl}
					<img class="avatar profile-avatar-preview" src={previewUrl} alt="" />
				{:else if showPhoto}
					<Avatar
						name={displayName || data.profile.username}
						size={112}
						{avatarPath}
						userId={data.profile.id}
					/>
				{:else}
					<Avatar name={displayName || data.profile.username} size={112} avatarPath={null} />
				{/if}
				<button
					type="button"
					class="profile-avatar-cam"
					aria-label={i18n.t('profile.changeAvatar')}
					onclick={() => fileInput?.click()}
				>
					<Camera size={18} />
				</button>
				<input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onAvatar} />
			</div>

			<div class="profile-avatar-actions">
				{#if showBanner}
					<button type="button" class="btn btn-ghost profile-remove-avatar" onclick={clearBanner}>
						<Trash2 size={16} />
						{i18n.t('profile.removeBanner')}
					</button>
				{/if}
				{#if showPhoto}
					<button type="button" class="btn btn-ghost profile-remove-avatar" onclick={clearAvatar}>
						<Trash2 size={16} />
						{i18n.t('profile.removeAvatar')}
					</button>
				{/if}
			</div>
			<p class="profile-edit-hint">@{data.profile.username}</p>
		</section>

		<section class="settings-section">
			<div class="settings-card soft pad settings-form-stack">
				<div class="field">
					<div class="field-head">
						<label for="displayName">{i18n.t('profile.displayName')}</label>
						<span class="field-count">{displayName.length}/{NAME_MAX}</span>
					</div>
					<input
						id="displayName"
						maxlength={NAME_MAX}
						bind:value={displayName}
						placeholder={data.profile.username}
						autocomplete="nickname"
					/>
					<p class="field-hint">{i18n.t('profile.displayNameHint')}</p>
				</div>
				<div class="field">
					<div class="field-head">
						<label for="bio">{i18n.t('profile.bio')}</label>
						<span class="field-count">{bio.length}/{BIO_MAX}</span>
					</div>
					<textarea
						id="bio"
						class="profile-bio-input"
						maxlength={BIO_MAX}
						rows="4"
						bind:value={bio}
						placeholder={i18n.t('profile.bioPlaceholder')}
					></textarea>
				</div>
			</div>
		</section>

		{#if error}
			<p class="profile-flash profile-flash-error">{error}</p>
		{:else if status}
			<p class="profile-flash">{status}</p>
		{/if}

		<section class="settings-section profile-edit-actions">
			<button class="btn btn-block" type="submit" disabled={saving || !dirty}>
				{saving ? i18n.t('profile.saving') : i18n.t('profile.save')}
			</button>
		</section>
	</form>
</div>
