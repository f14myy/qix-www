import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const row = db.select({ e2eePublicKey: users.e2eePublicKey }).from(users).where(eq(users.id, locals.user.id)).get();
	let publicKey = null;
	if (row?.e2eePublicKey) {
		try {
			publicKey = JSON.parse(row.e2eePublicKey);
		} catch {
			publicKey = null;
		}
	}
	return json({ publicKey });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const publicKey = (body as { publicKey?: unknown })?.publicKey;
	if (!publicKey || typeof publicKey !== 'object') {
		return json({ error: 'publicKey required' }, { status: 400 });
	}
	const jwk = publicKey as JsonWebKey;
	if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
		return json({ error: 'Invalid P-256 JWK' }, { status: 400 });
	}
	// Never accept private key material
	if (jwk.d) return json({ error: 'Private key must not be uploaded' }, { status: 400 });

	db.update(users)
		.set({ e2eePublicKey: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }) })
		.where(eq(users.id, locals.user.id))
		.run();

	return json({ ok: true });
};
