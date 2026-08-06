import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { chatMembers, chats, messages } from '$lib/server/schema';
import { createId } from '$lib/server/id';

const MAX_IMPORT_SIZE = 15 * 1024 * 1024;
const MAX_IMPORT_MESSAGES = 20_000;

type TelegramMessage = { type?: unknown; text?: unknown; from?: unknown; date_unixtime?: unknown };
type TelegramChat = { name?: unknown; messages?: unknown };

function textFrom(value: unknown): string {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) return value.map((part) => textFrom(part)).join('');
	if (value && typeof value === 'object' && 'text' in value) return textFrom((value as { text?: unknown }).text);
	return '';
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File) || file.size > MAX_IMPORT_SIZE) {
		return json({ error: 'Choose a Telegram result.json file up to 15 MB' }, { status: 400 });
	}
	let source: { chats?: { list?: TelegramChat[] } };
	try {
		source = JSON.parse(await file.text()) as { chats?: { list?: TelegramChat[] } };
	} catch {
		return json({ error: 'This is not a valid Telegram JSON export' }, { status: 400 });
	}
	const list = Array.isArray(source.chats?.list) ? source.chats.list : [];
	let importedChats = 0;
	let importedMessages = 0;
	for (const sourceChat of list.slice(0, 500)) {
		if (importedMessages >= MAX_IMPORT_MESSAGES) break;
		const sourceMessages = Array.isArray(sourceChat.messages) ? sourceChat.messages : [];
		const prepared = sourceMessages
			.filter((entry): entry is TelegramMessage => !!entry && typeof entry === 'object')
			.filter((entry) => entry.type === 'message')
			.map((entry) => {
				const body = textFrom(entry.text).trim();
				const from = typeof entry.from === 'string' ? entry.from.trim() : '';
				return { body: from && body ? `${from}: ${body}` : body, at: Number(entry.date_unixtime) };
			})
			.filter((entry) => !!entry.body)
			.slice(0, MAX_IMPORT_MESSAGES - importedMessages);
		if (!prepared.length) continue;
		const title = typeof sourceChat.name === 'string' ? sourceChat.name.slice(0, 120) : 'Telegram archive';
		const chatId = createId();
		db.insert(chats)
			.values({ id: chatId, kind: 'group', title: `Telegram: ${title}`, ownerId: locals.user.id, createdAt: new Date() })
			.run();
		db.insert(chatMembers)
			.values({ chatId, userId: locals.user.id, role: 'owner', joinedAt: new Date() })
			.run();
		for (const entry of prepared) {
			const createdAt = Number.isFinite(entry.at) && entry.at > 0 ? new Date(entry.at * 1000) : new Date();
			db.insert(messages)
				.values({ id: createId(), chatId, senderId: locals.user.id, body: entry.body, kind: 'text', createdAt })
				.run();
		}
		importedChats += 1;
		importedMessages += prepared.length;
	}
	return json({ importedChats, importedMessages, media: false });
};
