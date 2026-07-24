import webpush from 'web-push';
import { eq, and } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { chatMembers, pushSubscriptions } from './schema';
import { getUserSettings } from './settings';

export type PushPayload = {
	title: string;
	body: string;
	href?: string;
	tag?: string;
};

function vapidKeys() {
	const publicKey = env.VAPID_PUBLIC_KEY?.trim();
	const privateKey = env.VAPID_PRIVATE_KEY?.trim();
	const subject = env.VAPID_SUBJECT?.trim() || 'mailto:admin@localhost';
	if (!publicKey || !privateKey) return null;
	return { publicKey, privateKey, subject };
}

let configured = false;

function ensureConfigured() {
	const keys = vapidKeys();
	if (!keys) return null;
	if (!configured) {
		webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
		configured = true;
	}
	return keys;
}

export function getVapidPublicKey(): string | null {
	return vapidKeys()?.publicKey ?? null;
}

export function isPushConfigured(): boolean {
	return !!vapidKeys();
}

export function saveSubscription(
	userId: string,
	sub: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
	const now = new Date();
	const existing = db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.endpoint, sub.endpoint))
		.get();

	if (existing) {
		db.update(pushSubscriptions)
			.set({
				userId,
				p256dh: sub.keys.p256dh,
				auth: sub.keys.auth,
				createdAt: now
			})
			.where(eq(pushSubscriptions.endpoint, sub.endpoint))
			.run();
	} else {
		db.insert(pushSubscriptions)
			.values({
				endpoint: sub.endpoint,
				userId,
				p256dh: sub.keys.p256dh,
				auth: sub.keys.auth,
				createdAt: now
			})
			.run();
	}
}

export function deleteSubscription(userId: string, endpoint: string) {
	db.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
		.run();
}

function isChatMuted(chatId: string, userId: string): boolean {
	const row = db
		.select({ muted: chatMembers.muted })
		.from(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.get();
	return !!row?.muted;
}

export async function sendPushToUser(
	userId: string,
	payload: PushPayload,
	opts?: { chatId?: string; kind?: 'message' | 'reaction' }
): Promise<void> {
	if (!ensureConfigured()) return;

	const settings = getUserSettings(userId);
	if (opts?.kind === 'reaction' && !settings.notifyReactions) return;
	if (opts?.kind !== 'reaction' && !settings.notifyMessages) return;
	if (opts?.chatId && isChatMuted(opts.chatId, userId)) return;

	const subs = db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId))
		.all();

	if (!subs.length) return;

	const body = JSON.stringify({
		title: payload.title,
		body: payload.body,
		href: payload.href ?? '/',
		tag: payload.tag ?? 'qix-message'
	});

	await Promise.all(
		subs.map(async (sub) => {
			try {
				await webpush.sendNotification(
					{
						endpoint: sub.endpoint,
						keys: { p256dh: sub.p256dh, auth: sub.auth }
					},
					body
				);
			} catch (err: unknown) {
				const status = (err as { statusCode?: number })?.statusCode;
				if (status === 404 || status === 410) {
					db.delete(pushSubscriptions)
						.where(eq(pushSubscriptions.endpoint, sub.endpoint))
						.run();
				}
			}
		})
	);
}
