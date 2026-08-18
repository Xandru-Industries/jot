import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

function decorations(doc: any) {
  const values: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== "list_item" || node.attrs.checked == null) return;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(node.attrs.checked);
    input.tabIndex = 0;
    input.dataset.taskPos = String(pos);
    input.setAttribute("contenteditable", "false");
    input.setAttribute("aria-label", input.checked ? "Mark task incomplete" : "Mark task complete");
    values.push(Decoration.widget(pos + 1, input, { key: `task-${pos}-${input.checked}` }));
  });
  return DecorationSet.create(doc, values);
}

function toggle(view: any, target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.dataset.taskPos) return false;
  const pos = Number(target.dataset.taskPos);
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "list_item") return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
  return true;
}

export const tasksPlugin = $prose(() => new Plugin({
  props: {
    decorations: (state) => decorations(state.doc),
    handleDOMEvents: {
      mousedown: (_view, event) => event.target instanceof HTMLInputElement && event.target.type === "checkbox",
      click: (view, event) => toggle(view, event.target),
      keydown: (view, event) => (event.key === " " || event.key === "Enter") && toggle(view, event.target),
    },
  },
}));
