<script lang="ts">
	import Mic from '@lucide/svelte/icons/mic';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Send from '@lucide/svelte/icons/send';
	import X from '@lucide/svelte/icons/x';
	import type { MessageDTO } from '$lib/types';

	let {
		disabled = false,
		replyTo = null as MessageDTO | null,
		editing = null as MessageDTO | null,
		placeholder = 'Message',
		recordingLabel = 'Recording…',
		ontyping,
		onclearReply,
		onclearEdit,
		onsend
	}: {
		disabled?: boolean;
		replyTo?: MessageDTO | null;
		editing?: MessageDTO | null;
		placeholder?: string;
		recordingLabel?: string;
		ontyping?: () => void;
		onclearReply?: () => void;
		onclearEdit?: () => void;
		onsend: (payload: {
			body: string;
			files: File[];
			kind?: 'text' | 'voice';
			replyToId?: string | null;
			editId?: string | null;
		}) => void | Promise<void>;
	} = $props();

	let body = $state('');
	let files = $state<File[]>([]);
	let sending = $state(false);
	let recording = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	let mediaRecorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];

	$effect(() => {
		if (editing) body = editing.body;
	});

	const canSend = $derived(
		(body.trim().length > 0 || files.length > 0 || recording) && !sending && !disabled
	);

	async function submit() {
		if (recording) return;
		if (!canSend && !editing) return;
		sending = true;
		try {
			await onsend({
				body: body.trim(),
				files: [...files],
				kind: 'text',
				replyToId: replyTo?.id ?? null,
				editId: editing?.id ?? null
			});
			body = '';
			files = [];
		} finally {
			sending = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function onInput() {
		ontyping?.();
	}

	function onFiles(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		files = [...files, ...Array.from(input.files ?? [])].slice(0, 5);
		input.value = '';
	}

	async function toggleRecord() {
		if (recording && mediaRecorder) {
			mediaRecorder.stop();
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			chunks = [];
			mediaRecorder = new MediaRecorder(stream);
			mediaRecorder.ondataavailable = (ev) => {
				if (ev.data.size) chunks.push(ev.data);
			};
			mediaRecorder.onstop = async () => {
				recording = false;
				stream.getTracks().forEach((t) => t.stop());
				const blob = new Blob(chunks, { type: 'audio/webm' });
				const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
				sending = true;
				try {
					await onsend({
						body: '',
						files: [file],
						kind: 'voice',
						replyToId: replyTo?.id ?? null
					});
				} finally {
					sending = false;
				}
			};
			mediaRecorder.start();
			recording = true;
		} catch {
			recording = false;
		}
	}
</script>

<div class="composer-wrap">
	{#if replyTo}
		<div class="composer-banner">
			<div>
				<strong>{placeholder && '↩'}</strong>
				<span>{replyTo.body?.slice(0, 80) || '…'}</span>
			</div>
			<button type="button" class="icon-btn" style="width:32px;height:32px" onclick={onclearReply}>
				<X size={16} />
			</button>
		</div>
	{/if}
	{#if editing}
		<div class="composer-banner edit">
			<div>
				<strong>✎</strong>
				<span>{editing.body?.slice(0, 80)}</span>
			</div>
			<button type="button" class="icon-btn" style="width:32px;height:32px" onclick={onclearEdit}>
				<X size={16} />
			</button>
		</div>
	{/if}

	{#if files.length}
		<div class="pending-files">
			{#each files as file, i (file.name + i)}
				<span class="pending-chip">
					{file.name}
					<button
						type="button"
						class="icon-btn"
						style="width:22px;height:22px"
						onclick={() => (files = files.filter((_, idx) => idx !== i))}
					>
						<X size={12} />
					</button>
				</span>
			{/each}
		</div>
	{/if}

	{#if recording}
		<div class="recording-bar">{recordingLabel}</div>
	{/if}

	<div class="composer">
		<input bind:this={fileInput} type="file" multiple hidden onchange={onFiles} />
		<button
			type="button"
			class="icon-btn"
			aria-label="Attach"
			onclick={() => fileInput?.click()}
			disabled={sending || recording || !!editing}
		>
			<Paperclip size={20} />
		</button>
		<textarea
			rows="1"
			{placeholder}
			bind:value={body}
			onkeydown={onKeydown}
			oninput={onInput}
			disabled={sending || recording}
		></textarea>
		{#if body.trim() || files.length || editing}
			<button type="button" class="send" aria-label="Send" disabled={!canSend && !editing} onclick={submit}>
				<Send size={18} />
			</button>
		{:else}
			<button
				type="button"
				class="send"
				class:recording
				aria-label="Voice"
				disabled={sending}
				onclick={toggleRecord}
			>
				<Mic size={18} />
			</button>
		{/if}
	</div>
</div>
