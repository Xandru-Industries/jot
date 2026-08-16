import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  prosePluginsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/core";
import { clipboard } from "@milkdown/plugin-clipboard";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { TextSelection } from "@milkdown/prose/state";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";

import { createPresencePlugin, presenceKey, type RemoteSelection } from "./presence";
import { SelectionBridge, type ProseMirrorSelection, type SourceSelection } from "./selection-bridge";

type RichEditorOptions = {
  root: HTMLElement;
  markdown: string;
  onChange(markdown: string): void;
  onSelectionChange?(selection: SourceSelection): void;
};

export async function createRichEditor(options: RichEditorOptions) {
  let currentMarkdown = options.markdown;
  let revision = 0;
  let suppressChanges = false;
  let composing = false;
  let compositionBase = "";
  let compositionMarkdown = "";
  let compositionActive = false;
  let deferredReplacement: { markdown: string; selection?: SourceSelection } | null = null;
  let pendingCompositionMarkdown: string | null = null;
  let bridge: SelectionBridge;

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root);
      ctx.set(defaultValueCtx, options.markdown);
      ctx.update(prosePluginsCtx, (plugins) => [...plugins, createPresencePlugin()]);
      ctx.get(listenerCtx)
        .markdownUpdated((_ctx, markdown, previousMarkdown) => {
          currentMarkdown = markdown;
          const view = _ctx.get(editorViewCtx);
          bridge?.invalidate(++revision, markdown, view.state.doc);
          if (composing || _ctx.get(editorViewCtx).composing) compositionMarkdown = markdown;
          if (!suppressChanges && !composing && !_ctx.get(editorViewCtx).composing && markdown !== previousMarkdown) options.onChange(markdown);
        })
        .selectionUpdated((_ctx, selection) => {
          if (suppressChanges) return;
          if (bridge) options.onSelectionChange?.(bridge.toMarkdown({ anchor: selection.anchor, head: selection.head }));
        });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .create();

  const view = editor.ctx.get(editorViewCtx);
  bridge = new SelectionBridge(options.markdown, view.state.doc);
  const isComposing = () => compositionActive || composing || view.composing;

  const handleCompositionStart = () => {
    compositionActive = true;
    composing = true;
    compositionBase = currentMarkdown;
    compositionMarkdown = currentMarkdown;
  };
  const handleCompositionEnd = () => {
    window.setTimeout(() => {
      const composedMarkdown = compositionMarkdown;
      const replacement = deferredReplacement;
      deferredReplacement = null;
      composing = false;
      compositionActive = false;
      if (!replacement) {
        if (composedMarkdown !== compositionBase) options.onChange(composedMarkdown);
        return;
      }
      const merged = mergeConcurrentMarkdown(compositionBase, composedMarkdown, replacement.markdown);
      const composedSelection = getSourceSelection();
      currentMarkdown = replacement.markdown;
      replaceMarkdown(merged.markdown, merged.mapSelection(composedSelection));
      if (merged.markdown !== replacement.markdown) {
        pendingCompositionMarkdown = merged.markdown;
        window.setTimeout(() => {
          if (pendingCompositionMarkdown === merged.markdown) options.onChange(merged.markdown);
        }, 20);
      }
    }, 0);
  };
  const beginComposition = () => handleCompositionStart();
  const endComposition = () => handleCompositionEnd();
  view.dom.addEventListener("compositionstart", handleCompositionStart);
  view.dom.addEventListener("compositionend", handleCompositionEnd);

  function replaceMarkdown(markdown: string, selection?: SourceSelection) {
    if (isComposing()) {
      deferredReplacement = { markdown, selection };
      return;
    }
    if (markdown === currentMarkdown) {
      return;
    }
    if (pendingCompositionMarkdown && markdown !== pendingCompositionMarkdown) return;
    if (markdown === pendingCompositionMarkdown) pendingCompositionMarkdown = null;
    const parser = editor.ctx.get(parserCtx);
    const doc = parser(markdown);
    if (!doc) return;
    suppressChanges = true;
    const transaction = view.state.tr
      .replaceWith(0, view.state.doc.content.size, doc.content)
      .setMeta("addToHistory", false)
      .setMeta("jotAuthoritative", true);
    view.dispatch(transaction);
    currentMarkdown = markdown;
    bridge.invalidate(++revision, markdown, view.state.doc);
    if (selection) setSourceSelection(selection);
    queueMicrotask(() => { suppressChanges = false; });
  }

  function setSourceSelection(selection: SourceSelection) {
    const mapped = bridge.toProseMirror(selection);
    const anchor = Math.max(0, Math.min(mapped.anchor, view.state.doc.content.size));
    const head = Math.max(0, Math.min(mapped.head, view.state.doc.content.size));
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
    } catch {
      view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
    }
  }

  function getSourceSelection() {
    return bridge.toMarkdown({ anchor: view.state.selection.anchor, head: view.state.selection.head });
  }

  function updatePresence(peers: RemoteSelection[]) {
    view.dispatch(view.state.tr.setMeta(presenceKey, peers));
  }

  return {
    replaceMarkdown,
    getSelectionBridge: () => bridge,
    getSourceSelection,
    setSourceSelection,
    updatePresence,
    beginComposition() {
      compositionActive = true;
      composing = true;
      compositionBase = currentMarkdown;
      compositionMarkdown = currentMarkdown;
    },
    endComposition() {
      compositionActive = false;
      composing = false;
      handleCompositionEnd();
    },
    findText(text: string) {
      let found: { from: number; to: number } | null = null;
      view.state.doc.descendants((node: ProseNode, position: number) => {
        if (!node.isText || found) return;
        const offset = (node.text || "").indexOf(text);
        if (offset >= 0) found = { from: position + offset, to: position + offset + text.length };
      });
      if (!found) throw new Error(`Text not found: ${text}`);
      return found;
    },
    insertText(text: string) {
      view.dispatch(view.state.tr.insertText(text));
      if (isComposing()) compositionMarkdown = editor.ctx.get(serializerCtx)(view.state.doc);
    },
    getMarkdown() {
      return editor.ctx.get(serializerCtx)(view.state.doc);
    },
    async destroy() {
      view.dom.removeEventListener("compositionstart", handleCompositionStart);
      view.dom.removeEventListener("compositionend", handleCompositionEnd);
      await editor.destroy();
    },
  };
}

function changedRange(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  return { start, beforeEnd, afterEnd };
}

function mergeConcurrentMarkdown(base: string, local: string, authoritative: string) {
  const localChange = changedRange(base, local);
  const remoteChange = changedRange(base, authoritative);
  const mapOffset = (offset: number) => {
    if (offset <= remoteChange.start) return offset;
    if (offset >= remoteChange.beforeEnd) return offset + remoteChange.afterEnd - remoteChange.beforeEnd;
    return remoteChange.afterEnd;
  };
  const start = mapOffset(localChange.start);
  const end = mapOffset(localChange.beforeEnd);
  const inserted = local.slice(localChange.start, localChange.afterEnd);
  return {
    markdown: authoritative.slice(0, start) + inserted + authoritative.slice(end),
    mapSelection(selection: SourceSelection): SourceSelection {
      return {
        start: mapOffset(selection.start),
        end: mapOffset(selection.end),
        direction: selection.direction,
      };
    },
  };
}
