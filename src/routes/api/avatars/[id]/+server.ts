import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { db, uploadsDir } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const user = db.select().from(users).where(eq(users.id, params.id)).get();
	if (!user?.avatarPath) error(404, 'Not found');

	const filePath = join(uploadsDir, user.avatarPath);
	if (!existsSync(filePath)) error(404, 'File missing');

	const stats = statSync(filePath);
	const ext = user.avatarPath.split('.').pop()?.toLowerCase();
	const mime =
		ext === 'png'
			? 'image/png'
			: ext === 'webp'
				? 'image/webp'
				: ext === 'gif'
					? 'image/gif'
					: 'image/jpeg';

	const nodeStream = createReadStream(filePath);
	const webStream = Readable.toWeb(nodeStream) as ReadableStream;

	return new Response(webStream, {
		headers: {
			'content-type': mime,
			'content-length': String(stats.size),
			'cache-control': 'private, max-age=3600'
		}
	});
};
