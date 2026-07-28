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
import { getChatMeta } from '$lib/server/features';
import { canPostInChat } from '$lib/server/channels';
import { getGroupSummary } from '$lib/server/groups';
import { publishToChat, publishToChatMembers } from '$lib/server/events';
import { extractFirstUrl, fetchLinkPreview } from '$lib/server/linkPreview';
import { sendPushToUser } from '$lib/server/push';
import { getUserSettings, isBlockedEither } from '$lib/server/settings';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

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

	if (!canPostInChat(chatId, locals.user)) {
		return json({ error: 'You cannot post in this channel' }, { status: 403 });
	}

	const contentType = request.headers.get('content-type') ?? '';
	let body = '';
	let replyToId: string | null = null;
	let kind = 'text';
	const files: File[] = [];
	const fileE2eeMetas: (string | null)[] = [];

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		body = String(form.get('body') ?? '').trim();
		const reply = form.get('replyToId');
		if (typeof reply === 'string' && reply) replyToId = reply;
		const k = form.get('kind');
		if (k === 'voice' || k === 'video') kind = k;
		const metasRaw = form.get('e2eeFileMetas');
		let metas: (string | null)[] = [];
		if (typeof metasRaw === 'string' && metasRaw) {
			try {
				metas = JSON.parse(metasRaw) as (string | null)[];
			} catch {
				metas = [];
			}
		}
		let fi = 0;
		for (const entry of form.getAll('files')) {
			if (entry instanceof File && entry.size > 0) {
				files.push(entry);
				fileE2eeMetas.push(typeof metas[fi] === 'string' ? metas[fi]! : null);
				fi += 1;
			}
		}
	} else {
		const jsonBody = await request.json().catch(() => null);
		body = String((jsonBody as { body?: unknown })?.body ?? '').trim();
		const reply = (jsonBody as { replyToId?: unknown })?.replyToId;
		if (typeof reply === 'string' && reply) replyToId = reply;
		const k = (jsonBody as { kind?: unknown })?.kind;
		if (k === 'voice' || k === 'video') kind = k;
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
			return json({ error: `File "${file.name}" exceeds 25 MB` }, { status: 400 });
		}
	}

	if (kind === 'voice' && files.length === 0) {
		return json({ error: 'Voice message requires audio' }, { status: 400 });
	}
	if (kind === 'video' && files.length === 0) {
		return json({ error: 'Video message requires video' }, { status: 400 });
	}

	const meta = getChatMeta(chatId);
	const expireMs = meta?.disappearAfterSec ? meta.disappearAfterSec * 1000 : 0;
	const messageId = createId();
	const createdAt = new Date();
	const expiresAt = expireMs ? new Date(createdAt.getTime() + expireMs) : null;

	db.insert(messages)
		.values({
			id: messageId,
			chatId,
			senderId: locals.user.id,
			body,
			kind,
			replyToId,
			createdAt,
			expiresAt
		})
		.run();

	for (let i = 0; i < files.length; i++) {
		const file = files[i]!;
		const e2eeMeta = fileE2eeMetas[i] ?? null;
		const attId = createId();
		const ext =
			extname(file.name).slice(0, 16) ||
			(kind === 'voice'
				? file.type.includes('mp4') || file.type.includes('m4a')
					? '.m4a'
					: '.webm'
				: kind === 'video'
					? '.mp4'
					: e2eeMeta
						? '.qix'
						: '');
		const storedName = `${attId}${ext}`;
		const diskPath = join(uploadsDir, storedName);
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(diskPath, buffer);

		const voiceMime =
			e2eeMeta
				? 'application/octet-stream'
				: file.type ||
					(kind === 'voice'
						? ext === '.m4a'
							? 'audio/mp4'
							: 'audio/webm'
						: kind === 'video'
							? 'video/mp4'
							: 'application/octet-stream');

		db.insert(attachments)
			.values({
				id: attId,
				messageId,
				filename:
					file.name.slice(0, 255) ||
					(ext === '.m4a' ? 'voice.m4a' : kind === 'video' ? 'video.mp4' : 'voice.webm'),
				mime: voiceMime,
				size: file.size,
				path: storedName,
				e2eeMeta
			})
			.run();
	}

	const isE2ee = body.startsWith('e2ee:1:');
	const url = !isE2ee ? extractFirstUrl(body) : null;
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
	const allMembers = getChatMemberIds(chatId);
	publishToChatMembers(allMembers, 'chat_update', { chatId });

	const senderName = locals.user.displayName || locals.user.username;
	let preview = isE2ee ? 'Encrypted message' : body;
	if (!isE2ee && !preview) {
		if (kind === 'voice') preview = 'Voice message';
		else if (kind === 'video') preview = 'Video';
		else if (files.length) preview = 'Photo';
		else preview = 'New message';
	}

	if (peer) {
		void sendPushToUser(
			peer.id,
			{
				title: senderName,
				body: preview.slice(0, 120),
				href: `/chat/${chatId}`,
				tag: `qix-chat-${chatId}`
			},
			{ chatId, kind: 'message' }
		);
	} else {
		/*
		 * A group notification names the room, not the sender — otherwise fifteen
		 * groups all look like one stream of unfamiliar names. The sender moves into
		 * the body, where it disambiguates instead of misleading.
		 */
		const group = getGroupSummary(chatId);
		if (group) {
			for (const memberId of allMembers) {
				if (memberId === locals.user.id) continue;
				void sendPushToUser(
					memberId,
					{
						title: group.title,
						body: `${senderName}: ${preview}`.slice(0, 160),
						href: `/chat/${chatId}`,
						tag: `qix-chat-${chatId}`
					},
					{ chatId, kind: 'message' }
				);
			}
		}
	}

	return json({ message }, { status: 201 });
};
