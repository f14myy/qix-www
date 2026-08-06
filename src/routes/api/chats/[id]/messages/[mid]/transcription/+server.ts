import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { getMessageById, isChatMember } from '$lib/server/chats';
import { db, uploadsDir } from '$lib/server/db';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { attachments } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

const MAX_TRANSCRIBE_SIZE = 25 * 1024 * 1024;

export const POST: RequestHandler = async ({ params, locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!env.GROQ_API_KEY) {
		return json({ error: 'Voice transcription is not configured' }, { status: 503 });
	}
	const limited = rateLimit(`transcribe:${locals.user.id}:${clientIp(request, getClientAddress)}`, 12, 60_000);
	if (!limited.ok) return json({ error: 'Try again in a minute' }, { status: 429 });
	const message = getMessageById(params.mid);
	if (!message || message.chatId !== params.id || !isChatMember(params.id, locals.user.id)) {
		return json({ error: 'Message not found' }, { status: 404 });
	}
	const attachment = db
		.select()
		.from(attachments)
		.where(eq(attachments.messageId, message.id))
		.all()
		.find((item) => item.mime.startsWith('audio/'));
	if (!attachment || attachment.e2eeMeta || attachment.size > MAX_TRANSCRIBE_SIZE) {
		return json({ error: 'This voice message cannot be transcribed' }, { status: 400 });
	}

	try {
		const bytes = await readFile(join(uploadsDir, attachment.path));
		const form = new FormData();
		form.set('model', 'whisper-large-v3');
		form.set('response_format', 'json');
		form.set('file', new Blob([bytes], { type: attachment.mime }), attachment.filename);
		const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
			method: 'POST',
			headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
			body: form
		});
		const result = (await response.json().catch(() => null)) as { text?: unknown; error?: { message?: unknown } } | null;
		if (!response.ok || typeof result?.text !== 'string') {
			return json({ error: typeof result?.error?.message === 'string' ? result.error.message : 'Transcription failed' }, { status: 502 });
		}
		return json({ text: result.text.trim() });
	} catch {
		return json({ error: 'Transcription failed' }, { status: 502 });
	}
};
