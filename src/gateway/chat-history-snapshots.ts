const MAX_CHAT_HISTORY_SNAPSHOT_MESSAGES = 1000;
const MAX_CHAT_HISTORY_SNAPSHOT_ENTRIES = 500;

export type ChatHistorySnapshot = {
  sessionId?: string;
  messages: unknown[];
  updatedAt: number;
};

export type ChatHistorySnapshotStore = Map<string, ChatHistorySnapshot>;

function cloneMessage<T>(value: T): T {
  return structuredClone(value);
}

function trimSnapshotStore(store: ChatHistorySnapshotStore) {
  while (store.size > MAX_CHAT_HISTORY_SNAPSHOT_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (typeof oldestKey !== "string" || !oldestKey) {
      break;
    }
    store.delete(oldestKey);
  }
}

export function getChatHistorySnapshot(
  store: ChatHistorySnapshotStore | undefined,
  sessionKey: string,
): ChatHistorySnapshot | undefined {
  if (!store) {
    return undefined;
  }
  const existing = store.get(sessionKey);
  if (!existing) {
    return undefined;
  }
  // LRU bump.
  store.delete(sessionKey);
  store.set(sessionKey, existing);
  return existing;
}

export function clearChatHistorySnapshot(
  store: ChatHistorySnapshotStore | undefined,
  sessionKey: string,
): void {
  store?.delete(sessionKey);
}

export function replaceChatHistorySnapshot(params: {
  store: ChatHistorySnapshotStore | undefined;
  sessionKey: string;
  sessionId?: string;
  messages: unknown[];
}): void {
  if (!params.store) {
    return;
  }
  params.store.set(params.sessionKey, {
    sessionId: params.sessionId,
    messages: params.messages.map((message) => cloneMessage(message)),
    updatedAt: Date.now(),
  });
  trimSnapshotStore(params.store);
}

export function appendChatHistorySnapshotMessage(params: {
  store: ChatHistorySnapshotStore | undefined;
  sessionKey: string;
  sessionId?: string;
  message: unknown;
  reset?: boolean;
}): void {
  if (!params.store) {
    return;
  }
  const existing = params.store.get(params.sessionKey);
  const existingSessionId = existing?.sessionId;
  const sessionChanged =
    typeof params.sessionId === "string" &&
    params.sessionId.length > 0 &&
    typeof existingSessionId === "string" &&
    existingSessionId.length > 0 &&
    existingSessionId !== params.sessionId;
  const nextMessages =
    params.reset || sessionChanged ? [] : existing?.messages.map((message) => cloneMessage(message)) ?? [];
  nextMessages.push(cloneMessage(params.message));
  if (nextMessages.length > MAX_CHAT_HISTORY_SNAPSHOT_MESSAGES) {
    nextMessages.splice(0, nextMessages.length - MAX_CHAT_HISTORY_SNAPSHOT_MESSAGES);
  }
  params.store.set(params.sessionKey, {
    sessionId: params.sessionId ?? existingSessionId,
    messages: nextMessages,
    updatedAt: Date.now(),
  });
  trimSnapshotStore(params.store);
}
