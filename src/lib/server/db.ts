import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './schema';

const dataDir = join(process.cwd(), 'data');
const uploadsDir = join(dataDir, 'uploads');

mkdirSync(uploadsDir, { recursive: true });

const sqlite = new Database(join(dataDir, 'qix.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		display_name TEXT,
		bio TEXT,
		avatar_path TEXT,
		last_seen_at INTEGER,
		locale TEXT,
		banned_at INTEGER,
		banned_reason TEXT,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at INTEGER NOT NULL,
		user_agent TEXT,
		created_at INTEGER,
		last_seen_at INTEGER
	);

	CREATE TABLE IF NOT EXISTS recovery_codes (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		code_hash TEXT NOT NULL,
		used_at INTEGER
	);

	CREATE TABLE IF NOT EXISTS chats (
		id TEXT PRIMARY KEY,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS chat_members (
		chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		last_read_at INTEGER,
		pinned_at INTEGER,
		muted INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (chat_id, user_id)
	);

	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		body TEXT NOT NULL DEFAULT '',
		kind TEXT NOT NULL DEFAULT 'text',
		reply_to_id TEXT,
		edited_at INTEGER,
		deleted_at INTEGER,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS attachments (
		id TEXT PRIMARY KEY,
		message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		filename TEXT NOT NULL,
		mime TEXT NOT NULL,
		size INTEGER NOT NULL,
		path TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS message_reactions (
		message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		emoji TEXT NOT NULL,
		PRIMARY KEY (message_id, user_id)
	);

	CREATE TABLE IF NOT EXISTS link_previews (
		id TEXT PRIMARY KEY,
		message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		url TEXT NOT NULL,
		title TEXT,
		description TEXT,
		image_url TEXT
	);

	CREATE TABLE IF NOT EXISTS user_settings (
		user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		notify_messages INTEGER NOT NULL DEFAULT 1,
		notify_reactions INTEGER NOT NULL DEFAULT 1,
		haptics INTEGER NOT NULL DEFAULT 1,
		send_with_enter INTEGER NOT NULL DEFAULT 1,
		link_previews INTEGER NOT NULL DEFAULT 1,
		last_seen_visibility TEXT NOT NULL DEFAULT 'everyone',
		read_receipts INTEGER NOT NULL DEFAULT 1,
		show_typing INTEGER NOT NULL DEFAULT 1,
		who_can_message TEXT NOT NULL DEFAULT 'everyone',
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS blocks (
		blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (blocker_id, blocked_id)
	);

	CREATE TABLE IF NOT EXISTS badges (
		id TEXT PRIMARY KEY,
		label TEXT NOT NULL,
		color TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS user_badges (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		badge_id TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (user_id, badge_id)
	);

	CREATE TABLE IF NOT EXISTS push_subscriptions (
		endpoint TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		p256dh TEXT NOT NULL,
		auth TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS message_requests (
		id TEXT PRIMARY KEY,
		from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		note TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'pending',
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS user_reports (
		id TEXT PRIMARY KEY,
		reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		reported_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		reason TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		resolved_at INTEGER
	);

	CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
	CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
	CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
	CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
	CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
	CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);
`);

function ensureColumn(table: string, column: string, ddl: string) {
	const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	if (!cols.some((c) => c.name === column)) {
		sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
	}
}

ensureColumn('users', 'display_name', 'display_name TEXT');
ensureColumn('users', 'bio', 'bio TEXT');
ensureColumn('users', 'avatar_path', 'avatar_path TEXT');
ensureColumn('users', 'last_seen_at', 'last_seen_at INTEGER');
ensureColumn('users', 'locale', 'locale TEXT');
ensureColumn('chat_members', 'last_read_at', 'last_read_at INTEGER');
ensureColumn('chat_members', 'pinned_at', 'pinned_at INTEGER');
ensureColumn('chat_members', 'muted', 'muted INTEGER NOT NULL DEFAULT 0');
ensureColumn('messages', 'kind', "kind TEXT NOT NULL DEFAULT 'text'");
ensureColumn('messages', 'reply_to_id', 'reply_to_id TEXT');
ensureColumn('messages', 'edited_at', 'edited_at INTEGER');
ensureColumn('messages', 'deleted_at', 'deleted_at INTEGER');
ensureColumn('users', 'banned_at', 'banned_at INTEGER');
ensureColumn('users', 'banned_reason', 'banned_reason TEXT');
ensureColumn('users', 'banner_key', "banner_key TEXT NOT NULL DEFAULT 'default'");
ensureColumn('users', 'banner_path', 'banner_path TEXT');
ensureColumn('sessions', 'user_agent', 'user_agent TEXT');
ensureColumn('sessions', 'created_at', 'created_at INTEGER');
ensureColumn('sessions', 'last_seen_at', 'last_seen_at INTEGER');
ensureColumn('user_settings', 'profile_visibility', "profile_visibility TEXT NOT NULL DEFAULT 'everyone'");
ensureColumn('user_settings', 'last_seen_reciprocity', 'last_seen_reciprocity INTEGER NOT NULL DEFAULT 1');
ensureColumn('user_settings', 'confirm_message_delete', 'confirm_message_delete INTEGER NOT NULL DEFAULT 1');
ensureColumn('user_settings', 'auto_play_voice', 'auto_play_voice INTEGER NOT NULL DEFAULT 1');
ensureColumn('user_settings', 'notify_sound', 'notify_sound INTEGER NOT NULL DEFAULT 1');
ensureColumn('user_settings', 'look', "look TEXT NOT NULL DEFAULT 'qix'");
ensureColumn('user_settings', 'theme', "theme TEXT NOT NULL DEFAULT 'system'");
ensureColumn('chat_members', 'archived_at', 'archived_at INTEGER');
ensureColumn('chats', 'pinned_message_id', 'pinned_message_id TEXT');
ensureColumn('chats', 'disappear_after_sec', 'disappear_after_sec INTEGER NOT NULL DEFAULT 0');
ensureColumn('messages', 'forwarded_from_id', 'forwarded_from_id TEXT');
ensureColumn('messages', 'expires_at', 'expires_at INTEGER');
ensureColumn('users', 'invite_code', 'invite_code TEXT');
ensureColumn('users', 'e2ee_public_key', 'e2ee_public_key TEXT');
ensureColumn('attachments', 'e2ee_meta', 'e2ee_meta TEXT');
ensureColumn('chats', 'kind', "kind TEXT NOT NULL DEFAULT 'dm'");
ensureColumn('chats', 'channel_key', 'channel_key TEXT');
ensureColumn('chats', 'title', 'title TEXT');
ensureColumn('chats', 'posting', "posting TEXT NOT NULL DEFAULT 'members'");
ensureColumn('users', 'profile_style', "profile_style TEXT NOT NULL DEFAULT 'auto'");
ensureColumn('users', 'profile_color', 'profile_color TEXT');
ensureColumn('users', 'profile_color2', 'profile_color2 TEXT');
ensureColumn('users', 'profile_auto_banner', 'profile_auto_banner TEXT');
ensureColumn('users', 'profile_auto_avatar', 'profile_auto_avatar TEXT');
ensureColumn('chats', 'owner_id', 'owner_id TEXT');
ensureColumn('chats', 'avatar_path', 'avatar_path TEXT');
ensureColumn('chats', 'invite_code', 'invite_code TEXT');
ensureColumn('chats', 'inviting', "inviting TEXT NOT NULL DEFAULT 'members'");
ensureColumn('chats', 'description', 'description TEXT');
ensureColumn('chat_members', 'role', "role TEXT NOT NULL DEFAULT 'member'");
ensureColumn('chat_members', 'joined_at', 'joined_at INTEGER');

/*
 * Group join links are looked up by code on every /g/<code> visit, and the code
 * must be unique across groups or a link would be ambiguous. Partial so the many
 * DMs and channels with a NULL code do not collide with each other.
 */
sqlite.exec(
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_invite_code
		ON chats(invite_code) WHERE invite_code IS NOT NULL`
);

export const db = drizzle(sqlite, { schema });
export { uploadsDir };
