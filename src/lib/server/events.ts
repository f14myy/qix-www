type Client = {
	userId: string;
	chatId: string | null;
	enqueue: (data: string) => void;
};

const clients = new Set<Client>();

/**
 * Comment frames keep the connection warm.
 *
 * Without them an idle stream is indistinguishable from a dead one: nothing is
 * ever written, so a browser that crashed mid-call is never noticed, and NAT or
 * a reverse proxy silently drops the socket after a few minutes. The interval is
 * short enough to stay under the usual 60s proxy idle timeout.
 */
const HEARTBEAT_MS = 25_000;
let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Notified when a user's last stream goes away — see `calls.ts`. */
const goneHandlers = new Set<(userId: string) => void>();

function startHeartbeat() {
	if (heartbeat) return;
	heartbeat = setInterval(() => {
		// enqueue() cleans up the client if the write fails, which is how a dead
		// connection is finally detected.
		for (const client of [...clients]) client.enqueue(`: ping\n\n`);
		if (clients.size === 0) stopHeartbeat();
	}, HEARTBEAT_MS);
	// Never hold the process open just to ping nobody.
	heartbeat.unref?.();
}

function stopHeartbeat() {
	if (!heartbeat) return;
	clearInterval(heartbeat);
	heartbeat = null;
}

/** How many live streams a user currently has (tabs, devices, the Android service). */
export function countUserStreams(userId: string): number {
	let n = 0;
	for (const client of clients) if (client.userId === userId) n += 1;
	return n;
}

/** Registers a listener for "this user has no streams left". */
export function onUserStreamsClosed(handler: (userId: string) => void): void {
	goneHandlers.add(handler);
}

export function subscribe(userId: string, chatId: string | null): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let client: Client;

	return new ReadableStream({
		start(controller) {
			client = {
				userId,
				chatId,
				enqueue: (data) => {
					try {
						controller.enqueue(encoder.encode(data));
					} catch {
						cleanup();
					}
				}
			};
			clients.add(client);
			startHeartbeat();
			client.enqueue(`: connected\n\n`);
		},
		cancel() {
			cleanup();
		}
	});

	function cleanup() {
		if (!client || !clients.delete(client)) return;
		if (clients.size === 0) stopHeartbeat();
		if (countUserStreams(client.userId) > 0) return;
		for (const handler of goneHandlers) {
			try {
				handler(client.userId);
			} catch {
				/* a listener must never break the stream teardown */
			}
		}
	}
}

export function publish(event: string, data: unknown, filter: (c: Client) => boolean): void {
	const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	for (const client of clients) {
		if (filter(client)) client.enqueue(payload);
	}
}

export function publishToChat(chatId: string, event: string, data: unknown): void {
	publish(event, data, (c) => c.chatId === chatId);
}

export function publishToUser(userId: string, event: string, data: unknown): void {
	publish(event, data, (c) => c.userId === userId);
}

export function publishToChatMembers(userIds: string[], event: string, data: unknown): void {
	const set = new Set(userIds);
	publish(event, data, (c) => set.has(c.userId));
}
