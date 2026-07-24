import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const row = db
		.select({ e2eePublicKey: users.e2eePublicKey })
		.from(users)
		.where(eq(users.id, params.id))
		.get();
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	let publicKey = null;
	if (row.e2eePublicKey) {
		try {
			publicKey = JSON.parse(row.e2eePublicKey);
		} catch {
			publicKey = null;
		}
	}
	return json({ publicKey });
};
