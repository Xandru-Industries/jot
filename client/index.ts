import { createCollabSession, type CollabSnapshot, type CollabStatus } from "./collab-session";
import { createRichEditor } from "./rich-editor";

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
      });
      options.onReady(snapshot.markdown, snapshot);
      resolveReady?.();
    },
    onSnapshot: (markdown, authoritative) => {
      latestAuthoritativeMarkdown = markdown;
      if (authoritative) richEditor?.replaceMarkdown(markdown);
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
    },
  };
}
