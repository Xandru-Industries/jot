export type CommentTextSegment = {
  node: Text;
  start: number;
  end: number;
};

export type CommentTextProjection = {
  fullText: string;
  segments: CommentTextSegment[];
};

const excludedSelector = ".mermaid-wrap, .mermaid-node, .mermaid-toolbar, .mermaid-preview, .remote-cursor, .remote-cursor-label, .ProseMirror-widget, svg, button, input";
const blockSelector = "h1,h2,h3,h4,h5,h6,p,li,th,td,pre,blockquote";

export function extractCommentText(root: HTMLElement): CommentTextProjection {
  const accepted: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest(excludedSelector)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) accepted.push(node);

  let fullText = "";
  const segments: CommentTextSegment[] = [];
  let previousBlock: Element | null = null;
  for (const textNode of accepted) {
    const block = textNode.parentElement?.closest(blockSelector) || textNode.parentElement;
    if (fullText && block !== previousBlock) fullText += "\n";
    const parent = textNode.parentElement;
    const value = parent?.closest("li") && parent.tagName !== "CODE"
      ? (textNode.nodeValue || "").replace(/^\s+(?=\S)/, "")
      : (textNode.nodeValue || "");
    const start = fullText.length;
    fullText += value;
    segments.push({ node: textNode, start, end: fullText.length });
    previousBlock = block;
  }
  return { fullText: fullText.trim(), segments };
}
