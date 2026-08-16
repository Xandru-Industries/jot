import { createCollabSession, type CollabSnapshot, type CollabStatus } from "./collab-session";
import { createRichEditor } from "./rich-editor";

export { createRichEditor } from "./rich-editor";
export { sanitizeMermaidSvg } from "./plugins/mermaid";

export type CreateRichCollabEditorOptions = {
  root: HTMLElement;
  noteId?: string;
  shareId?: string;
  onReady(markdown: string, snapshot: CollabSnapshot): void;
  onTextChange(markdown: string): void;
  onStatusChange(status: CollabStatus): void;
  onThreadsChanged(): void;
};

export async function createRichCollabEditor(options: CreateRichCollabEditorOptions) {
  let richEditor: Awaited<ReturnType<typeof createRichEditor>> | null = null;
  let destroyed = false;
  let latestAuthoritativeMarkdown = "";
  let resolveReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  const session = createCollabSession({
    noteId: options.noteId,
    shareId: options.shareId,
    onReady: async (snapshot) => {
      if (destroyed) return;
      latestAuthoritativeMarkdown = snapshot.markdown;
      richEditor = await createRichEditor({
        root: options.root,
        markdown: snapshot.markdown,
        onChange: (markdown) => session.replaceMarkdown(markdown),
        onSelectionChange: (selection) => session.setSelection(selection),
      });
      session.setSelectionProvider(() => richEditor?.getSourceSelection() || { start: 0, end: 0, direction: "none" });
      session.setRemotePresenceHandler((peers) => richEditor?.updatePresence(peers));
      if (typeof window !== "undefined") {
        (window as any).__jotRichEditorDebug = {
          insertText: (text: string) => richEditor?.insertText(text),
          getMarkdown: () => richEditor?.getMarkdown(),
          getSourceSelection: () => richEditor?.getSourceSelection(),
          setSourceSelection: (selection: any) => richEditor?.setSourceSelection(selection),
          beginComposition: () => richEditor?.beginComposition(),
          endComposition: () => richEditor?.endComposition(),
        };
      }
      options.onReady(snapshot.markdown, snapshot);
      resolveReady?.();
    },
    onSnapshot: (markdown, authoritative, selection) => {
      latestAuthoritativeMarkdown = markdown;
      if (authoritative) richEditor?.replaceMarkdown(markdown, selection);
      options.onTextChange(markdown);
    },
    onStatusChange: options.onStatusChange,
    onThreadsChanged: options.onThreadsChanged,
  });

  await ready;
  richEditor?.replaceMarkdown(latestAuthoritativeMarkdown);

  return {
    destroy() {
      destroyed = true;
      session.destroy();
      void richEditor?.destroy();
      if (typeof window !== "undefined") delete (window as any).__jotRichEditorDebug;
    },
  };
}
