type Client = {
	userId: string;
	chatId: string | null;
	enqueue: (data: string) => void;
};

const clients = new Set<Client>();

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
			client.enqueue(`: connected\n\n`);
		},
		cancel() {
			cleanup();
		}
	});

	function cleanup() {
		if (client) clients.delete(client);
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
