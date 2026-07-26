import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { db, uploadsDir } from '$lib/server/db';
import { attachments, messages } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { isChatMember } from '$lib/server/chats';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const att = db.select().from(attachments).where(eq(attachments.id, params.id)).get();
	if (!att) error(404, 'Not found');

	const msg = db.select().from(messages).where(eq(messages.id, att.messageId)).get();
	if (!msg || !isChatMember(msg.chatId, locals.user.id)) {
		error(404, 'Not found');
	}

	const filePath = join(uploadsDir, att.path);
	if (!existsSync(filePath)) error(404, 'File missing');

	const stats = statSync(filePath);
	const nodeStream = createReadStream(filePath);
	const webStream = Readable.toWeb(nodeStream) as ReadableStream;

	return new Response(webStream, {
		headers: {
			'content-type': att.mime,
			'content-length': String(stats.size),
			'content-disposition': `inline; filename="${encodeURIComponent(att.filename)}"`,
			// An attachment id is minted per upload and its bytes never change, so
			// this can be cached for good. Matters most on the phone clients, which
			// otherwise re-download every image in a chat over mobile data each
			// hour. Still `private` — the response is session-gated.
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
