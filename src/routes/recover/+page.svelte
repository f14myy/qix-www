<script lang="ts">
	import { goto } from '$app/navigation';
	import { useI18n } from '$lib/i18n/useI18n.svelte';

	const i18n = useI18n();
	let username = $state('');
	let code = $state('');
	let password = $state('');
	let password2 = $state('');
	let error = $state('');
	let loading = $state(false);

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		if (password !== password2) {
			error = i18n.t('security.passwordMismatch');
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/auth/recover', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, code, newPassword: password })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error || i18n.t('auth.recoverFailed');
				return;
			}
			await goto('/');
		} finally {
			loading = false;
		}
	}
</script>

<div class="screen auth-screen">
	<div class="auth-card">
		<h1 class="brand-title">Qix</h1>
		<p class="subtitle">{i18n.t('auth.recoverSubtitle')}</p>

		<form onsubmit={submit}>
			<div class="field">
				<label for="username">{i18n.t('auth.username')}</label>
				<input
					id="username"
					autocomplete="username"
					maxlength="9"
					bind:value={username}
					required
				/>
			</div>
			<div class="field">
				<label for="code">{i18n.t('auth.recoveryCode')}</label>
				<input
					id="code"
					autocomplete="one-time-code"
					placeholder="XXXX-XXXX-XXXX"
					bind:value={code}
					required
				/>
			</div>
			<div class="field">
				<label for="password">{i18n.t('security.newPassword')}</label>
				<input
					id="password"
					type="password"
					autocomplete="new-password"
					minlength="8"
					bind:value={password}
					required
				/>
			</div>
			<div class="field">
				<label for="password2">{i18n.t('security.confirmPassword')}</label>
				<input
					id="password2"
					type="password"
					autocomplete="new-password"
					minlength="8"
					bind:value={password2}
					required
				/>
			</div>
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<button class="btn btn-block" type="submit" disabled={loading}>
				{loading ? i18n.t('auth.recovering') : i18n.t('auth.recover')}
			</button>
		</form>

		<p class="auth-footer">
			<a href="/login">{i18n.t('auth.signInLink')}</a>
		</p>
	</div>
</div>
