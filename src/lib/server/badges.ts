import { and, asc, eq } from 'drizzle-orm';
import { type BadgeDTO, normalizeBadgeColor } from '$lib/badges';
import { createId } from './id';
import { db } from './db';
import { badges, userBadges, users } from './schema';

export type BadgeHolder = {
	id: string;
	username: string;
	displayName: string | null;
};

export type BadgeWithHolders = BadgeDTO & { holders: BadgeHolder[] };

export function listBadges(): BadgeDTO[] {
	return db
		.select({
			id: badges.id,
			label: badges.label,
			color: badges.color
		})
		.from(badges)
		.orderBy(asc(badges.createdAt))
		.all();
}

export function listBadgeHolders(badgeId: string): BadgeHolder[] {
	return db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName
		})
		.from(userBadges)
		.innerJoin(users, eq(userBadges.userId, users.id))
		.where(eq(userBadges.badgeId, badgeId))
		.orderBy(asc(users.username))
		.all();
}

export function listBadgesWithHolders(): BadgeWithHolders[] {
	return listBadges().map((badge) => ({
		...badge,
		holders: listBadgeHolders(badge.id)
	}));
}

export function getUserBadges(userId: string): BadgeDTO[] {
	return db
		.select({
			id: badges.id,
			label: badges.label,
			color: badges.color
		})
		.from(userBadges)
		.innerJoin(badges, eq(userBadges.badgeId, badges.id))
		.where(eq(userBadges.userId, userId))
		.orderBy(asc(userBadges.sortOrder), asc(userBadges.createdAt))
		.all();
}

export function createBadge(label: string, color: string): BadgeDTO | { error: string } {
	const trimmed = label.trim().slice(0, 40);
	if (!trimmed) return { error: 'Label required' };
	const id = createId();
	const c = normalizeBadgeColor(color);
	db.insert(badges)
		.values({ id, label: trimmed, color: c, createdAt: new Date() })
		.run();
	return { id, label: trimmed, color: c };
}

export function updateBadge(
	id: string,
	patch: { label?: string; color?: string }
): BadgeDTO | { error: string } {
	const existing = db.select().from(badges).where(eq(badges.id, id)).get();
	if (!existing) return { error: 'Not found' };
	const label =
		patch.label !== undefined ? patch.label.trim().slice(0, 40) || existing.label : existing.label;
	const color = patch.color !== undefined ? normalizeBadgeColor(patch.color) : existing.color;
	db.update(badges).set({ label, color }).where(eq(badges.id, id)).run();
	return { id, label, color };
}

export function deleteBadge(id: string): { ok: true } | { error: string } {
	const existing = db.select().from(badges).where(eq(badges.id, id)).get();
	if (!existing) return { error: 'Not found' };
	db.delete(badges).where(eq(badges.id, id)).run();
	return { ok: true };
}

export function grantBadge(
	badgeId: string,
	username: string
): { ok: true; holder: BadgeHolder } | { error: string } {
	const badge = db.select({ id: badges.id }).from(badges).where(eq(badges.id, badgeId)).get();
	if (!badge) return { error: 'Badge not found' };
	const name = username.trim().replace(/^@/, '').toLowerCase();
	if (!name) return { error: 'Username required' };
	const user = db.select().from(users).where(eq(users.username, name)).get();
	if (!user) return { error: 'User not found' };
	const existing = db
		.select({ userId: userBadges.userId })
		.from(userBadges)
		.where(and(eq(userBadges.userId, user.id), eq(userBadges.badgeId, badgeId)))
		.get();
	if (!existing) {
		const count =
			db
				.select({ userId: userBadges.userId })
				.from(userBadges)
				.where(eq(userBadges.userId, user.id))
				.all().length;
		db.insert(userBadges)
			.values({
				userId: user.id,
				badgeId,
				sortOrder: count,
				createdAt: new Date()
			})
			.run();
	}
	return {
		ok: true,
		holder: { id: user.id, username: user.username, displayName: user.displayName }
	};
}

export function revokeBadge(
	badgeId: string,
	userId: string
): { ok: true } | { error: string } {
	const badge = db.select({ id: badges.id }).from(badges).where(eq(badges.id, badgeId)).get();
	if (!badge) return { error: 'Badge not found' };
	db.delete(userBadges)
		.where(and(eq(userBadges.badgeId, badgeId), eq(userBadges.userId, userId)))
		.run();
	return { ok: true };
}
