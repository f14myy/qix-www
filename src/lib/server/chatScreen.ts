import { isAdmin } from '$lib/admin';
import type { GroupInfoDTO, GroupMemberDTO, MessageDTO, PublicProfile } from '$lib/types';
import { canPostInChat, getChannelByChatId } from './channels';
import {
	getMessageById,
	getMyLastReadAt,
	getPeer,
	getPeerLastReadAt,
	isChatMember,
	listMessages,
	toMessageDTO
} from './chats';
import { getChatMeta } from './features';
import { getGroupInfo, listGroupMembers } from './groups';

/**
 * Everything the chat screen needs, in one shape.
 *
 * The site renders this from `+page.server.ts` and the native apps fetch the
 * identical payload from `GET /api/chats/[id]`, because the app is a static SPA
 * with no SSR. Those two used to be hand-copied, which is exactly the kind of
 * duplication that goes stale the first time a field is added — so both now call
 * this.
 */
export type ChatScreenData = {
	chatId: string;
	kind: 'dm' | 'group' | 'channel';
	peer: PublicProfile | null;
	channel: {
		key: string;
		title: string;
		posting: 'admin' | 'none' | 'members';
		canPost: boolean;
	} | null;
	group: GroupInfoDTO | null;
	members: GroupMemberDTO[];
	peerLastReadAt: string | null;
	myLastReadAt: string | null;
	messages: MessageDTO[];
	pinnedMessageId: string | null;
	disappearAfterSec: number;
	pinnedMessage: MessageDTO | null;
	isAdmin: boolean;
};

export function getChatScreenData(
	chatId: string,
	user: { id: string; username: string }
): ChatScreenData | null {
	if (!isChatMember(chatId, user.id)) return null;

	const channel = getChannelByChatId(chatId);
	const group = channel ? null : getGroupInfo(chatId, user.id);
	const peer = channel || group ? null : getPeer(chatId, user.id);
	if (!channel && !group && !peer) return null;

	// Read receipts are a two-person idea; a group shows no "seen by" tick.
	const peerLastReadAt = peer ? getPeerLastReadAt(chatId, user.id) : null;
	const myLastReadAt = getMyLastReadAt(chatId, user.id);
	const meta = getChatMeta(chatId);
	const pinnedRow = meta?.pinnedMessageId ? getMessageById(meta.pinnedMessageId) : null;
	const pinnedMessage = pinnedRow && !pinnedRow.deletedAt ? toMessageDTO(pinnedRow, user.id) : null;

	return {
		chatId,
		kind: channel ? 'channel' : group ? 'group' : 'dm',
		peer,
		channel: channel
			? {
					key: channel.key,
					title: channel.title,
					posting: channel.posting,
					canPost: canPostInChat(chatId, user)
				}
			: null,
		group,
		members: group ? listGroupMembers(chatId, user.id) : [],
		peerLastReadAt: peerLastReadAt ? peerLastReadAt.toISOString() : null,
		myLastReadAt: myLastReadAt ? myLastReadAt.toISOString() : null,
		messages: listMessages(chatId, user.id, 100),
		pinnedMessageId: meta?.pinnedMessageId ?? null,
		disappearAfterSec: meta?.disappearAfterSec ?? 0,
		pinnedMessage,
		isAdmin: isAdmin(user)
	};
}
