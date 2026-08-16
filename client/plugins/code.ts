import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import hljs from "highlight.js";

export const codePlugin = $prose(() => new Plugin({
  props: {
    decorations(state) {
      const values: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "code_block") return;
        const language = String(node.attrs.language || "").split(/\s+/)[0];
        values.push(Decoration.node(pos, pos + node.nodeSize, {
          class: `hljs${language && hljs.getLanguage(language) ? ` language-${language}` : ""}`,
        }));
      });
      return DecorationSet.create(state.doc, values);
    },
  },
}));
