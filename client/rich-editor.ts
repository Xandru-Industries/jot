import { Editor, defaultValueCtx, rootCtx } from "@milkdown/core";
import { clipboard } from "@milkdown/plugin-clipboard";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { replaceAll } from "@milkdown/utils";

type RichEditorOptions = {
  root: HTMLElement;
  markdown: string;
  onChange(markdown: string): void;
};

export async function createRichEditor(options: RichEditorOptions) {
  let suppressChanges = false;
  let currentMarkdown = options.markdown;
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root);
      ctx.set(defaultValueCtx, options.markdown);
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previousMarkdown) => {
        currentMarkdown = markdown;
        if (!suppressChanges && markdown !== previousMarkdown) options.onChange(markdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .create();

  return {
    replaceMarkdown(markdown: string) {
      if (markdown === currentMarkdown) return;
      suppressChanges = true;
      editor.action(replaceAll(markdown));
      currentMarkdown = markdown;
      queueMicrotask(() => { suppressChanges = false; });
    },
    async destroy() {
      await editor.destroy();
    },
  };
}
