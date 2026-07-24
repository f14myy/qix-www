import { json } from '@sveltejs/kit';
import { writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { RequestHandler } from './$types';
import { db, uploadsDir } from '$lib/server/db';
import { attachments, linkPreviews, messages } from '$lib/server/schema';
import { createId } from '$lib/server/id';
import {
	getChatMemberIds,
	getMessageById,
	getPeer,
	isChatMember,
	listMessages,
	toMessageDTO
} from '$lib/server/chats';
import { publishToChat, publishToChatMembers } from '$lib/server/events';
import { extractFirstUrl, fetchLinkPreview } from '$lib/server/linkPreview';
import { sendPushToUser } from '$lib/server/push';
import { getUserSettings, isBlockedEither } from '$lib/server/settings';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const before = url.searchParams.get('before') ?? undefined;
	const msgs = listMessages(chatId, locals.user.id, 100, before);
	return json({ messages: msgs });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const peer = getPeer(chatId, locals.user.id);
	if (peer && isBlockedEither(locals.user.id, peer.id)) {
		return json({ error: 'Unable to message this user' }, { status: 403 });
	}

	const contentType = request.headers.get('content-type') ?? '';
	let body = '';
	let replyToId: string | null = null;
	let kind = 'text';
	const files: File[] = [];

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		body = String(form.get('body') ?? '').trim();
		const reply = form.get('replyToId');
		if (typeof reply === 'string' && reply) replyToId = reply;
		const k = form.get('kind');
		if (k === 'voice') kind = 'voice';
		for (const entry of form.getAll('files')) {
			if (entry instanceof File && entry.size > 0) files.push(entry);
		}
	} else {
		const jsonBody = await request.json().catch(() => null);
		body = String((jsonBody as { body?: unknown })?.body ?? '').trim();
		const reply = (jsonBody as { replyToId?: unknown })?.replyToId;
		if (typeof reply === 'string' && reply) replyToId = reply;
		if ((jsonBody as { kind?: unknown })?.kind === 'voice') kind = 'voice';
	}

	if (!body && files.length === 0) {
		return json({ error: 'Message cannot be empty' }, { status: 400 });
	}

	if (replyToId) {
		const parent = getMessageById(replyToId);
		if (!parent || parent.chatId !== chatId) {
			return json({ error: 'Invalid reply' }, { status: 400 });
		}
	}

	for (const file of files) {
		if (file.size > MAX_FILE_SIZE) {
			return json({ error: `File "${file.name}" exceeds 10 MB` }, { status: 400 });
		}
	}

	if (kind === 'voice' && files.length === 0) {
		return json({ error: 'Voice message requires audio' }, { status: 400 });
	}

	const messageId = createId();
	const createdAt = new Date();

	db.insert(messages)
		.values({
			id: messageId,
			chatId,
			senderId: locals.user.id,
			body,
			kind,
			replyToId,
			createdAt
		})
		.run();

	for (const file of files) {
		const attId = createId();
		const ext = extname(file.name).slice(0, 16) || (kind === 'voice' ? (file.type.includes('mp4') || file.type.includes('m4a') ? '.m4a' : '.webm') : '');
		const storedName = `${attId}${ext}`;
		const diskPath = join(uploadsDir, storedName);
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(diskPath, buffer);

		const voiceMime =
			file.type ||
			(kind === 'voice'
				? ext === '.m4a'
					? 'audio/mp4'
					: 'audio/webm'
				: 'application/octet-stream');

		db.insert(attachments)
			.values({
				id: attId,
				messageId,
				filename: file.name.slice(0, 255) || (ext === '.m4a' ? 'voice.m4a' : 'voice.webm'),
				mime: voiceMime,
				size: file.size,
				path: storedName
			})
			.run();
	}

	const url = extractFirstUrl(body);
	if (url && kind === 'text' && getUserSettings(locals.user.id).linkPreviews) {
		const preview = await fetchLinkPreview(url);
		if (preview) {
			db.insert(linkPreviews)
				.values({
					id: createId(),
					messageId,
					url: preview.url,
					title: preview.title,
					description: preview.description,
					imageUrl: preview.imageUrl
				})
				.run();
		}
	}

	const row = getMessageById(messageId)!;
	const message = toMessageDTO(row, locals.user.id);

	publishToChat(chatId, 'message', message);
	publishToChatMembers(getChatMemberIds(chatId), 'chat_update', { chatId });

	if (peer) {
		const title = locals.user.displayName || locals.user.username;
		let preview = body;
		if (!preview) {
			if (kind === 'voice') preview = 'Voice message';
			else if (files.length) preview = 'Photo';
			else preview = 'New message';
		}
		void sendPushToUser(
			peer.id,
			{
				title,
				body: preview.slice(0, 120),
				href: `/chat/${chatId}`,
				tag: `qix-chat-${chatId}`
			},
			{ chatId, kind: 'message' }
		);
	}

	return json({ message }, { status: 201 });
};
