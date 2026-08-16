import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

export type RemoteSelection = {
  clientId: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
};

export const presenceKey = new PluginKey<DecorationSet>("jot-presence");

export function createPresencePlugin() {
  return new Plugin({
    key: presenceKey,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, decorations) {
        const peers = transaction.getMeta(presenceKey) as RemoteSelection[] | undefined;
        if (!peers) return decorations.map(transaction.mapping, transaction.doc);
        const next: Decoration[] = [];
        for (const peer of peers) {
          const from = Math.min(peer.anchor, peer.head);
          const to = Math.max(peer.anchor, peer.head);
          if (to > from) {
            next.push(Decoration.inline(from, to, { class: "remote-selection", style: `--remote-color:${peer.color}` }));
          }
          next.push(Decoration.widget(peer.head, () => {
            const cursor = document.createElement("span");
            cursor.className = "remote-cursor";
            cursor.dataset.clientId = peer.clientId;
            cursor.style.setProperty("--remote-color", peer.color);
            const caret = document.createElement("span");
            caret.className = "remote-cursor-caret";
            const label = document.createElement("span");
            label.className = "remote-cursor-label";
            label.dataset.label = peer.name;
            label.setAttribute("aria-label", peer.name);
            cursor.append(caret, label);
            return cursor;
          }, { key: peer.clientId, side: 1 }));
        }
        return DecorationSet.create(transaction.doc, next);
      },
    },
    props: {
      decorations: (state) => presenceKey.getState(state),
    },
  });
}
