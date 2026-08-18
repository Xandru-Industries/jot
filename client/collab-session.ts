import {
  SimpleIdList,
  applyClientMutation,
  applyIdListUpdates,
  selectionFromIds,
  selectionToIds,
} from "../public/collab-shared.js";
import { createSourceDiffMutations, type ElementId, type SourceMutation } from "./source-diff";
import type { SourceSelection } from "./selection-bridge";

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
  onSnapshot(markdown: string, authoritative: boolean, selection?: SourceSelection): void;
  onStatusChange(status: CollabStatus): void;
  onThreadsChanged(): void;
};

type ClientState = { text: string; idList: InstanceType<typeof SimpleIdList> };
type IdSelection = ReturnType<typeof selectionToIds>;
type RemotePresence = { clientId: string; name: string; color: string; anchor: number; head: number };

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
  let selectionProvider: (() => SourceSelection) | null = null;
  let remotePresenceHandler: ((peers: RemotePresence[]) => void) | null = null;
  let localSelection: SourceSelection = { start: 0, end: 0, direction: "none" };
  const remoteCursors = new Map<string, { name: string; color: string; selection: IdSelection; lastUpdate: number }>();
  let lastPresenceSent = 0;
  let presenceTimer: number | null = null;
  let lastSentSelection = "";

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
    throttledPresence();
  }

  function currentSelection() {
    return selectionProvider?.() || localSelection;
  }

  function captureSelectionIds() {
    const selection = currentSelection();
    return selectionToIds(currentState.idList, selection.start, selection.end, selection.direction);
  }

  function sendPresence() {
    if (!initialized || socket?.readyState !== WebSocket.OPEN || !clientId) return;
    const selection = captureSelectionIds();
    const key = JSON.stringify(selection);
    if (key === lastSentSelection) return;
    lastSentSelection = key;
    socket.send(JSON.stringify({ type: "presence", clientId, selection }));
  }

  function throttledPresence() {
    const now = Date.now();
    if (now - lastPresenceSent >= 80) {
      lastPresenceSent = now;
      sendPresence();
      return;
    }
    if (presenceTimer !== null) window.clearTimeout(presenceTimer);
    presenceTimer = window.setTimeout(() => {
      lastPresenceSent = Date.now();
      sendPresence();
    }, 80 - (now - lastPresenceSent));
  }

  function renderRemotePresence() {
    const peers: RemotePresence[] = [];
    for (const [remoteClientId, info] of remoteCursors) {
      if (Date.now() - info.lastUpdate > 60000) {
        remoteCursors.delete(remoteClientId);
        continue;
      }
      const selection = selectionFromIds(info.selection, currentState.idList);
      peers.push({
        clientId: remoteClientId,
        name: info.name,
        color: info.color,
        anchor: selection.direction === "backward" ? selection.end : selection.start,
        head: selection.direction === "backward" ? selection.start : selection.end,
      });
    }
    remotePresenceHandler?.(peers);
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
    const selectionIds = initialized ? captureSelectionIds() : null;
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
    const selection = selectionIds ? selectionFromIds(selectionIds, currentState.idList) : undefined;
    options.onSnapshot(currentState.text, true, selection);
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
    lastSentSelection = "";
    if (presenceTimer !== null) {
      window.clearTimeout(presenceTimer);
      presenceTimer = null;
    }
    lastPresenceSent = Date.now();
    sendPresence();
    renderRemotePresence();
  }

  function receiveMutation(message: any) {
    if (!initialized) return;
    const selectionIds = captureSelectionIds();
    serverState = {
      text: message.markdown || "",
      idList: applyIdListUpdates(serverState.idList, message.idListUpdates || []),
    };
    if (message.senderId === clientId) {
      const index = pendingMutations.findIndex((mutation) => mutation.clientCounter === message.senderCounter);
      if (index !== -1) pendingMutations = pendingMutations.slice(index + 1);
    }
    currentState = replayPending(serverState, pendingMutations);
    const selection = selectionFromIds(selectionIds, currentState.idList);
    options.onSnapshot(currentState.text, true, selection);
    throttledPresence();
    renderRemotePresence();
  }

  function receivePresence(message: any) {
    if (!message.clientId || message.clientId === clientId) return;
    remoteCursors.set(message.clientId, {
      name: message.name || "Collaborator",
      color: message.color || "#5da7ff",
      selection: message.selection,
      lastUpdate: Date.now(),
    });
    renderRemotePresence();
  }

  function receivePresenceLeave(message: any) {
    remoteCursors.delete(message.clientId);
    renderRemotePresence();
  }

  function connect() {
    if (destroyed || !navigator.onLine) return;
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
      else if (message.type === "presence") receivePresence(message);
      else if (message.type === "presence-leave") receivePresenceLeave(message);
      else if (message.type === "threads-updated") options.onThreadsChanged();
    });
    socket.addEventListener("close", () => {
      if (destroyed) return;
      setStatus("disconnected");
      remoteCursors.clear();
      renderRemotePresence();
      window.setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX_MS);
        connect();
      }, reconnectDelay);
    });
    socket.addEventListener("error", () => setStatus("disconnected"));
  }

  connect();

  const handleOffline = () => {
    setStatus("disconnected");
    socket?.close();
  };
  const handleOnline = () => {
    if (!destroyed && socket?.readyState !== WebSocket.OPEN && socket?.readyState !== WebSocket.CONNECTING) connect();
  };
  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);

  return {
    replaceMarkdown,
    setSelection(selection: SourceSelection) {
      localSelection = selection;
      throttledPresence();
    },
    setSelectionProvider(provider: () => SourceSelection) {
      selectionProvider = provider;
      throttledPresence();
    },
    setRemotePresenceHandler(handler: (peers: RemotePresence[]) => void) {
      remotePresenceHandler = handler;
      renderRemotePresence();
    },
    destroy() {
      destroyed = true;
      if (presenceTimer !== null) window.clearTimeout(presenceTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      socket?.close();
    },
    getMarkdown() {
      return currentState.text;
    },
  };
}
