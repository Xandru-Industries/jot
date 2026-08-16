import { $prose } from "@milkdown/utils";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Plugin } from "@milkdown/prose/state";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { createMermaidControls } from "./mermaid-controls";

const cache = new Map<string, string>();
let renderId = 0;

export function sanitizeMermaidSvg(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return "";
  root.querySelectorAll("script, foreignObject, iframe, object, embed, image, audio, video, animate, animateMotion, animateTransform, set, discard").forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((element) => {
    if (element.nodeName.toLowerCase() === "style" && /(?:@import|expression\s*\(|javascript:|data:|url\(\s*["']?(?!#))/i.test(element.textContent || "")) {
      element.remove();
      return;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const unsafeUrl = /(?:javascript:|vbscript:|data:|expression\s*\()/i.test(value)
        || (/url\s*\(/i.test(value) && /url\s*\(\s*["']?(?!#)/i.test(value));
      if (name.startsWith("on") || unsafeUrl || ((name === "href" || name === "xlink:href") && !/^(#|https?:|mailto:)/i.test(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  for (const attribute of Array.from(root.attributes)) {
    if (attribute.name.toLowerCase().startsWith("on")) root.removeAttribute(attribute.name);
  }
  return new XMLSerializer().serializeToString(root);
}

function isMermaid(node: ProseNode) {
  return node.type.name === "code_block" && String(node.attrs.language || "").trim().split(/\s+/)[0].toLowerCase() === "mermaid";
}

function hasMermaidDiagramType(source: string) {
  return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey|xychart|block|packet|architecture)\b/i.test(source.trim());
}

class MermaidNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private preview: HTMLElement;
  private diagram: HTMLElement;
  private error: HTMLElement;
  private controls: ReturnType<typeof createMermaidControls>;
  private timer = 0;
  private source = "\u0000";
  private count = 0;

  constructor(private node: ProseNode, private view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "mermaid-node";
    this.preview = document.createElement("div");
    this.preview.className = "mermaid-preview";
    this.preview.contentEditable = "false";
    this.diagram = document.createElement("div");
    this.diagram.className = "mermaid-diagram";
    this.preview.append(this.diagram);
    this.controls = createMermaidControls(this.diagram);
    this.controls.dom.addEventListener("pointerdown", this.handleControlEvent, true);
    this.controls.dom.addEventListener("click", this.handleControlEvent, true);
    this.controls.dom.addEventListener("keydown", this.handleControlEvent, true);
    this.preview.append(this.controls.dom);
    this.error = document.createElement("div");
    this.error.className = "mermaid-error";
    this.error.hidden = true;
    this.preview.append(this.error);
    const sourceWrap = document.createElement("pre");
    sourceWrap.className = "mermaid-source-wrap";
    this.contentDOM = document.createElement("code");
    this.contentDOM.className = "mermaid-source";
    sourceWrap.append(this.contentDOM);
    this.dom.append(this.preview, sourceWrap);
    this.source = node.textContent;
    void this.render(node.textContent);
  }

  update(node: ProseNode) {
    if (!isMermaid(node)) return false;
    this.node = node;
    this.schedule(node.textContent);
    return true;
  }

  private schedule(source: string, delay = 180) {
    if (source === this.source && this.timer) return;
    if (source === this.source && (this.diagram.childElementCount || !this.error.hidden)) return;
    this.source = source;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.render(source), delay);
  }

  private async render(source: string) {
    this.timer = 0;
    try {
      if (!hasMermaidDiagramType(source)) throw new Error("Invalid Mermaid diagram");
      const theme = document.documentElement.dataset.theme === "light" ? "default" : "dark";
      const cacheKey = `${theme}\u0000${source}`;
      let svg = cache.get(cacheKey);
      if (!svg) {
        const mermaid = (window as any).__mermaid;
        if (!mermaid) throw new Error("Mermaid is unavailable");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, htmlLabels: false, flowchart: { htmlLabels: false } });
        await mermaid.parse(source);
        svg = sanitizeMermaidSvg((await Promise.race([
          mermaid.render(`jot-mermaid-${renderId++}`, source),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("Diagram rendering timed out")), 3000)),
        ]) as { svg: string }).svg);
        if (!svg) throw new Error("Diagram output was rejected");
        cache.set(cacheKey, svg);
      }
      if (source !== this.source) return;
      this.diagram.innerHTML = svg;
      this.error.hidden = true;
    } catch (error) {
      if (source !== this.source) return;
      this.diagram.replaceChildren();
      this.error.textContent = error instanceof Error ? error.message : "Unable to render diagram";
      this.error.hidden = false;
    }
    this.dom.dataset.renderCount = String(++this.count);
  }

  rerender = () => {
    this.source = `${this.source}\u0000`;
    this.schedule(this.node.textContent);
  };

  private handleControlEvent = (event: Event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-action]");
    if (!button || !this.controls.dom.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    if (event.type === "click" && (event as MouseEvent).detail !== 0) return;
    this.controls.activate(button.dataset.action || "");
  };

  stopEvent(event: Event) {
    return this.controls.dom.contains(event.target as Node);
  }

  destroy() {
    window.clearTimeout(this.timer);
    window.removeEventListener("jot-theme-change", this.rerender);
    this.controls.dom.removeEventListener("pointerdown", this.handleControlEvent, true);
    this.controls.dom.removeEventListener("click", this.handleControlEvent, true);
    this.controls.dom.removeEventListener("keydown", this.handleControlEvent, true);
  }
}

export const mermaidPlugin = $prose(() => new Plugin({
  props: {
    nodeViews: {
      code_block(node: ProseNode, view: EditorView) {
        if (!isMermaid(node)) return null as never;
        const nodeView = new MermaidNodeView(node, view);
        window.addEventListener("jot-theme-change", nodeView.rerender);
        return nodeView;
      },
    },
  },
}));
