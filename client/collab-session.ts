import {
  SimpleIdList,
  applyClientMutation,
  applyIdListUpdates,
} from "../public/collab-shared.js";
import { createSourceDiffMutations, type ElementId, type SourceMutation } from "./source-diff";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export type CollabStatus = "connecting" | "connected" | "disconnected";

export type CollabSnapshot = {
  noteId: string;
  title: string;
  shareId: string;
  markdown: string;
};

type CollabSessionOptions = {
  noteId?: string;
  shareId?: string;
  onReady(snapshot: CollabSnapshot): void;
  onSnapshot(markdown: string, authoritative: boolean): void;
  onStatusChange(status: CollabStatus): void;
  onThreadsChanged(): void;
};

type ClientState = { text: string; idList: InstanceType<typeof SimpleIdList> };

function replayPending(serverState: ClientState, pending: SourceMutation[]): ClientState {
  let state = { text: serverState.text, idList: serverState.idList.clone() };
  for (const mutation of pending) state = applyClientMutation(state, mutation);
  return state;
}

export function createCollabSession(options: CollabSessionOptions) {
  let socket: WebSocket | null = null;
  let destroyed = false;
  let initialized = false;
  let reconnectDelay = RECONNECT_BASE_MS;
  let nextClientCounter = 1;
  let nextBunchCounter = 0;
  let clientId = "";
  let serverState: ClientState = { text: "", idList: new SimpleIdList() };
  let currentState: ClientState = { text: "", idList: new SimpleIdList() };
  let pendingMutations: SourceMutation[] = [];

  const setStatus = (status: CollabStatus) => options.onStatusChange(status);

  function newId(before: ElementId | null, idList: ClientState["idList"], count: number): ElementId {
    if (clientId && before !== null && before.bunchId.startsWith(`${clientId}:`)) {
      const maxCounter = idList.maxCounter(before.bunchId);
      if (maxCounter === before.counter) return { bunchId: before.bunchId, counter: before.counter + 1 };
    }
    return { bunchId: `${clientId}:${nextBunchCounter++}:${crypto.randomUUID()}`, counter: 0 };
  }

  function publish(mutations: SourceMutation[]) {
    if (!mutations.length) return;
    for (const mutation of mutations) {
      currentState = applyClientMutation(currentState, mutation);
      pendingMutations.push(mutation);
    }
    options.onSnapshot(currentState.text, false);
    if (socket?.readyState === WebSocket.OPEN && clientId) {
      socket.send(JSON.stringify({ type: "mutation", clientId, mutations }));
    }
  }

  function replaceMarkdown(markdown: string) {
    if (!initialized || markdown === currentState.text) return;
    const mutations = createSourceDiffMutations(currentState, markdown, {
      nextCounter: () => nextClientCounter++,
      newId,
      apply: applyClientMutation,
    });
    publish(mutations);
  }

  function receiveHello(message: any) {
    if (message.clientId) clientId = message.clientId;
    serverState = {
      text: message.markdown || "",
      idList: SimpleIdList.load(message.idListState || []),
    };
    currentState = replayPending(serverState, pendingMutations);
    const firstSnapshot = !initialized;
    initialized = true;
    reconnectDelay = RECONNECT_BASE_MS;
    setStatus("connected");
    options.onSnapshot(currentState.text, true);
    if (firstSnapshot) {
      options.onReady({
        noteId: message.noteId,
        title: message.title,
        shareId: message.shareId,
        markdown: currentState.text,
      });
    }
    if (pendingMutations.length && socket?.readyState === WebSocket.OPEN && clientId) {
      socket.send(JSON.stringify({ type: "mutation", clientId, mutations: pendingMutations }));
    }
  }

  function receiveMutation(message: any) {
    if (!initialized) return;
    serverState = {
      text: message.markdown || "",
      idList: applyIdListUpdates(serverState.idList, message.idListUpdates || []),
    };
    if (message.senderId === clientId) {
      const index = pendingMutations.findIndex((mutation) => mutation.clientCounter === message.senderCounter);
      if (index !== -1) pendingMutations = pendingMutations.slice(index + 1);
    }
    currentState = replayPending(serverState, pendingMutations);
    options.onSnapshot(currentState.text, true);
  }

  function connect() {
    if (destroyed) return;
    setStatus(initialized ? "disconnected" : "connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const parameter = options.noteId
      ? `noteId=${encodeURIComponent(options.noteId)}`
      : `shareId=${encodeURIComponent(options.shareId || "")}`;
    socket = new WebSocket(`${protocol}//${location.host}/?${parameter}`);
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "hello") receiveHello(message);
      else if (message.type === "mutation") receiveMutation(message);
      else if (message.type === "threads-updated") options.onThreadsChanged();
    });
    socket.addEventListener("close", () => {
      if (destroyed) return;
      setStatus("disconnected");
      window.setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX_MS);
        connect();
      }, reconnectDelay);
    });
    socket.addEventListener("error", () => setStatus("disconnected"));
  }

  connect();

  return {
    replaceMarkdown,
    destroy() {
      destroyed = true;
      socket?.close();
    },
    getMarkdown() {
      return currentState.text;
    },
  };
}
